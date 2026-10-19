import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { nativeImage } from 'electron'
import * as ort from 'onnxruntime-node'
import { resourcePath } from '../paths'

/**
 * 本地 OCR 引擎：PP-OCRv4（ONNX）+ onnxruntime，完全离线，模型随安装包一起发。
 *
 * 为什么不用系统自带 OCR：WinRT 的 OcrLine 不提供置信度，而「金额认错」比「认不出来」危险得多。
 * 这里每个文本块都带分数，解析层据此把低置信度的行标出来让人核对。
 *
 * 管线（照搬 RapidOCR 的官方参数，见 resources/ocr 里的原版 config）：
 *   解码图片 → det 概率图 → 阈值+膨胀 → 连通域 → 文本行框 → unclip 外扩
 *   → 按行裁剪 → rec（3×48×W）→ CTC 解码 → 归一化坐标
 *
 * 关键取舍：**用轴对齐矩形而不是最小面积旋转框**。
 * 账单截图里文字都是水平排列的，轴对齐框配合「左侧分类列 / 右侧金额列」的版面规则更稳，
 * 也省掉了一整套多边形偏移计算。
 */

const MODEL_FILES = {
  det: 'ch_PP-OCRv4_det_infer.onnx',
  rec: 'ch_PP-OCRv4_rec_infer.onnx'
} as const

const KEYS_FILE = 'ppocr_keys_v1.txt'

/** det 官方参数 */
const DET = {
  /** 长边上限：超过就等比缩小（上限越大越准、越慢） */
  maxSide: 2000,
  /** 概率图二值化阈值 */
  thresh: 0.3,
  /** 文本行平均分下限，低于它整块丢掉 */
  boxThresh: 0.5,
  /** 外扩系数，和官方一致：文本行要留白，否则 rec 会切掉笔画 */
  unclipRatio: 1.6
}

/** rec 官方参数 */
const REC = {
  height: 48,
  maxWidth: 320,
  /** 单个字符的最低分，整块分数取平均 */
  minCharScore: 0.3
}

export interface OcrTextBox {
  text: string
  /** 归一化坐标（0-1） */
  x: number
  y: number
  w: number
  h: number
  /** 识别置信度 0-1 */
  score: number
}

let detSession: ort.InferenceSession | null = null
let recSession: ort.InferenceSession | null = null
let dictionary: string[] | null = null

/** 模型目录：开发时读仓库 resources/ocr/models，打包后读 resourcesPath/ocr/models */
export function ocrModelDir(): string {
  return resourcePath('ocr', 'models')
}

export function ocrAvailable(): boolean {
  const dir = ocrModelDir()
  return (
    existsSync(path.join(dir, MODEL_FILES.det)) &&
    existsSync(path.join(dir, MODEL_FILES.rec)) &&
    existsSync(path.join(dir, KEYS_FILE))
  )
}

/** 首次调用时加载模型，之后复用（模型加载 ~1-2s，不能每张图都加载） */
async function ensureSessions(): Promise<{ det: ort.InferenceSession; rec: ort.InferenceSession }> {
  if (!ocrAvailable()) {
    throw new Error('识别引擎未安装：缺少 resources/ocr/models 下的 PP-OCR 模型')
  }
  if (!detSession) {
    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: Math.max(2, Math.min(4, require('node:os').cpus().length - 1))
    }
    detSession = await ort.InferenceSession.create(path.join(ocrModelDir(), MODEL_FILES.det), options)
    recSession = await ort.InferenceSession.create(path.join(ocrModelDir(), MODEL_FILES.rec), options)
    // 字典：第 0 位是 blank，末尾补一个空格（与 PaddleOCR 的 CTC 口径一致，合计 6625）
    dictionary = readFileSync(path.join(ocrModelDir(), KEYS_FILE), 'utf-8').split(/\r?\n/).filter((line) => line.length > 0)
  }
  return { det: detSession as ort.InferenceSession, rec: recSession as ort.InferenceSession }
}

/** 识别一张图片，返回归一化坐标的文本块 */
export async function recognize(filePath: string): Promise<OcrTextBox[]> {
  const { det, rec } = await ensureSessions()

  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) throw new Error(`读不出图片：${filePath}`)
  const size = image.getSize()

  const boxes = await detectTextLines(det, image, size)
  if (boxes.length === 0) return []

  const results: OcrTextBox[] = []
  for (const box of boxes) {
    const recognized = await recognizeLine(rec, image, box)
    if (recognized && recognized.text.trim()) {
      results.push({
        text: recognized.text.trim(),
        x: box.x / size.width,
        y: box.y / size.height,
        w: box.w / size.width,
        h: box.h / size.height,
        score: recognized.score
      })
    }
  }
  return results.sort((a, b) => a.y - b.y || a.x - b.x)
}

interface PixelBox {
  x: number
  y: number
  w: number
  h: number
}

/** det：概率图 → 文本行框（原图坐标系） */
async function detectTextLines(
  session: ort.InferenceSession,
  image: Electron.NativeImage,
  size: { width: number; height: number }
): Promise<PixelBox[]> {
  // 等比缩放到长边上限，再对齐到 32 的倍数（det 的下采样要求）
  const scale = Math.min(1, DET.maxSide / Math.max(size.width, size.height))
  const rawW = Math.max(32, Math.round(size.width * scale))
  const rawH = Math.max(32, Math.round(size.height * scale))
  const inputW = Math.ceil(rawW / 32) * 32
  const inputH = Math.ceil(rawH / 32) * 32

  const resized = image.resize({ width: inputW, height: inputH, quality: 'good' })
  const bitmap = resized.toBitmap() // BGRA
  const input = new Float32Array(3 * inputW * inputH)
  const area = inputW * inputH
  for (let i = 0; i < area; i++) {
    const b = bitmap[i * 4] / 255
    const g = bitmap[i * 4 + 1] / 255
    const r = bitmap[i * 4 + 2] / 255
    // mean=0.5 std=0.5 → (x - 0.5) / 0.5
    input[i] = (r - 0.5) / 0.5
    input[area + i] = (g - 0.5) / 0.5
    input[area * 2 + i] = (b - 0.5) / 0.5
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, inputH, inputW])
  const outputs = await session.run({ [session.inputNames[0]]: tensor })
  const prob = outputs[session.outputNames[0]].data as Float32Array

  const mask = binarize(prob, inputW, inputH, DET.thresh)
  dilate(mask, inputW, inputH)

  const components = connectedComponents(mask, inputW, inputH)
  const backScaleX = size.width / inputW
  const backScaleY = size.height / inputH
  const boxes: PixelBox[] = []

  for (const comp of components) {
    if (comp.points < 12) continue // 太小的噪点
    const score = meanScore(prob, mask, inputW, comp)
    if (score < DET.boxThresh) continue
    const expanded = unclip(comp, DET.unclipRatio, inputW, inputH)
    boxes.push({
      x: Math.max(0, expanded.x * backScaleX),
      y: Math.max(0, expanded.y * backScaleY),
      w: Math.min(size.width, expanded.w * backScaleX),
      h: Math.min(size.height, expanded.h * backScaleY)
    })
  }
  return boxes.filter((box) => box.w >= 6 && box.h >= 6)
}

function binarize(prob: Float32Array, width: number, height: number, thresh: number): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) mask[i] = prob[i] > thresh ? 1 : 0
  return mask
}

/** 2×2 膨胀两轮：把同一行的单字粘成一条文本行（不做的话每个字一个框） */
function dilate(mask: Uint8Array, width: number, height: number): void {
  for (let pass = 0; pass < 2; pass++) {
    const copy = mask.slice()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (copy[y * width + x]) continue
        if (
          (x > 0 && copy[y * width + x - 1]) ||
          (x + 1 < width && copy[y * width + x + 1]) ||
          (y > 0 && copy[(y - 1) * width + x]) ||
          (y + 1 < height && copy[(y + 1) * width + x])
        ) {
          mask[y * width + x] = 1
        }
      }
    }
  }
}

interface Component extends PixelBox {
  points: number
}

/** 8 邻域连通域，返回外接矩形 */
function connectedComponents(mask: Uint8Array, width: number, height: number): Component[] {
  const seen = new Uint8Array(mask.length)
  const components: Component[] = []
  const stack: number[] = []

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0
    let points = 0

    while (stack.length) {
      const index = stack.pop() as number
      const x = index % width
      const y = (index - x) / width
      points++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const next = ny * width + nx
          if (mask[next] && !seen[next]) {
            seen[next] = 1
            stack.push(next)
          }
        }
      }
    }
    components.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, points })
  }
  return components
}

function meanScore(prob: Float32Array, mask: Uint8Array, width: number, comp: Component): number {
  let sum = 0
  let count = 0
  for (let y = comp.y; y < comp.y + comp.h; y++) {
    for (let x = comp.x; x < comp.x + comp.w; x++) {
      const index = y * width + x
      if (!mask[index]) continue
      sum += prob[index]
      count++
    }
  }
  return count === 0 ? 0 : sum / count
}

/** 外扩：delta = 面积 × 系数 / 周长，和 PaddleOCR 的 unclip 同口径（轴对齐版） */
function unclip(box: PixelBox, ratio: number, width: number, height: number): PixelBox {
  const area = box.w * box.h
  const perimeter = 2 * (box.w + box.h)
  const delta = perimeter === 0 ? 0 : (area * ratio) / perimeter
  const x = Math.max(0, box.x - delta)
  const y = Math.max(0, box.y - delta)
  const right = Math.min(width, box.x + box.w + delta)
  const bottom = Math.min(height, box.y + box.h + delta)
  return { x, y, w: right - x, h: bottom - y }
}

/** rec：裁剪一条文本行 → 3×48×W → CTC 解码 */
async function recognizeLine(
  session: ort.InferenceSession,
  image: Electron.NativeImage,
  box: PixelBox
): Promise<{ text: string; score: number } | null> {
  const crop = image.crop({
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.max(1, Math.round(box.w)),
    height: Math.max(1, Math.round(box.h))
  })
  if (crop.isEmpty()) return null

  const targetW = Math.min(REC.maxWidth, Math.max(16, Math.round((box.w / box.h) * REC.height)))
  const resized = crop.resize({ width: targetW, height: REC.height, quality: 'good' })
  const bitmap = resized.toBitmap()
  const input = new Float32Array(3 * REC.height * targetW)
  const area = REC.height * targetW
  for (let i = 0; i < area; i++) {
    input[i] = (bitmap[i * 4 + 2] / 255 - 0.5) / 0.5
    input[area + i] = (bitmap[i * 4 + 1] / 255 - 0.5) / 0.5
    input[area * 2 + i] = (bitmap[i * 4] / 255 - 0.5) / 0.5
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, REC.height, targetW])
  const outputs = await session.run({ [session.inputNames[0]]: tensor })
  const output = outputs[session.outputNames[0]]
  const [, steps, classes] = output.dims as [number, number, number]
  const data = output.data as Float32Array
  return ctcDecode(data, steps, classes)
}

/** CTC 贪心解码：blank 在 0，字典从 1 开始，末尾是空格 */
function ctcDecode(data: Float32Array, steps: number, classes: number): { text: string; score: number } {
  const dict = dictionary as string[]
  const chars: string[] = []
  const scores: number[] = []
  let last = -1

  for (let t = 0; t < steps; t++) {
    let best = 0
    let bestScore = -Infinity
    for (let c = 0; c < classes; c++) {
      const value = data[t * classes + c]
      if (value > bestScore) {
        bestScore = value
        best = c
      }
    }
    if (best !== last && best > 0 && bestScore >= REC.minCharScore) {
      // 0 = blank；1..dict.length = 字典；最后一位 = 空格
      if (best <= dict.length) chars.push(dict[best - 1])
      else chars.push(' ')
      scores.push(bestScore)
    }
    last = best
  }

  const text = chars.join('')
  const score = scores.length === 0 ? 0 : scores.reduce((sum, value) => sum + value, 0) / scores.length
  return { text, score }
}
