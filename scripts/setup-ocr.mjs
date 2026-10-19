/**
 * 准备账单截图识别用的 PP-OCRv4 模型（约 15MB），放进 resources/ocr/models。
 *
 * 用法：npm run setup:ocr
 *
 * 为什么从这里取：PaddleOCR 官方只发 Paddle 格式（还要 paddle2onnx 转换），
 * 而 RapidOCR 的 Python wheel 里直接带好了 ONNX 版本，且参数（阈值/外扩系数）也是调好的。
 * 我们只下 wheel、解出模型，不装 Python、不装 paddle —— 运行时用 onnxruntime-node 跑。
 *
 * 网络：PyPI 与 jsDelivr；失败时可重试，或在有网的机器上跑完把 resources/ocr 一起拷过来。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'resources', 'ocr')
const modelDir = path.join(outDir, 'models')
const keysTarget = path.join(modelDir, 'ppocr_keys_v1.txt')

const WANTED = ['ch_PP-OCRv4_det_infer.onnx', 'ch_PP-OCRv4_rec_infer.onnx']
const KEYS_URLS = [
  'https://cdn.jsdelivr.net/gh/PaddlePaddle/PaddleOCR@main/ppocr/utils/ppocr_keys_v1.txt',
  'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt'
]

const missing = WANTED.filter((name) => !existsSync(path.join(modelDir, name)))
if (missing.length === 0 && existsSync(keysTarget)) {
  console.log('[setup:ocr] 模型已就绪，跳过下载')
  console.log(`[setup:ocr] ${modelDir}`)
  process.exit(0)
}

mkdirSync(modelDir, { recursive: true })

if (missing.length > 0) {
  console.log('[setup:ocr] 从 PyPI 取 RapidOCR wheel（内含 PP-OCRv4 ONNX 模型）…')
  const script = `
    const fs = require('fs')
    const path = require('path')
    ;(async () => {
      const meta = await (await fetch('https://pypi.org/pypi/rapidocr-onnxruntime/json')).json()
      const version = meta.info.version
      const wheel = meta.releases[version]
        .filter((f) => f.filename.endsWith('.whl'))
        .sort((a, b) => b.size - a.size)[0]
      console.log('[setup:ocr] wheel', wheel.filename, (wheel.size / 1048576).toFixed(1) + 'MB')
      const buf = Buffer.from(await (await fetch(wheel.url)).arrayBuffer())
      fs.writeFileSync(path.join(process.env.OCR_OUT, 'rapidocr.whl'), buf)
    })().catch((error) => { console.error('[setup:ocr] 下载失败：', error.message); process.exit(1) })
  `
  execFileSync(process.execPath, ['-e', script], { stdio: 'inherit', env: { ...process.env, OCR_OUT: outDir } })

  const wheel = path.join(outDir, 'rapidocr.whl')
  console.log('[setup:ocr] 解出模型…')
  const unzipDir = path.join(outDir, '_wheel')
  rmSync(unzipDir, { recursive: true, force: true })
  mkdirSync(unzipDir, { recursive: true })
  // 用 .NET 的 ZipFile：wheel 本质就是 zip，改扩展名即可
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath '${wheel}' -DestinationPath '${unzipDir}' -Force`
  ], { stdio: 'inherit' })

  const find = (dir, name) => {
    for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const hit = find(full, name)
        if (hit) return hit
      } else if (entry.name === name) {
        return full
      }
    }
    return null
  }
  for (const name of WANTED) {
    const found = find(unzipDir, name)
    if (!found) {
      console.error(`[setup:ocr] wheel 里没找到 ${name}`)
      process.exit(1)
    }
    writeFileSync(path.join(modelDir, name), readFileSync(found))
    console.log(`[setup:ocr]   ${name} → ${(readFileSync(found).length / 1048576).toFixed(2)}MB`)
  }
  rmSync(wheel, { force: true })
  rmSync(unzipDir, { recursive: true, force: true })
}

if (!existsSync(keysTarget)) {
  console.log('[setup:ocr] 取字符字典（CTC 解码必需）…')
  const script = `
    const fs = require('fs')
    ;(async () => {
      const urls = ${JSON.stringify(KEYS_URLS)}
      for (const url of urls) {
        try {
          const res = await fetch(url)
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const text = await res.text()
          if (text.split('\\n').length < 1000) throw new Error('字典内容异常')
          fs.writeFileSync(process.env.KEYS_TARGET, text, 'utf8')
          console.log('[setup:ocr] 字典来自', url)
          return
        } catch (error) {
          console.warn('[setup:ocr] 失败', url, error.message)
        }
      }
      process.exit(1)
    })()
  `
  execFileSync(process.execPath, ['-e', script], {
    stdio: 'inherit',
    env: { ...process.env, KEYS_TARGET: keysTarget }
  })
}

const total = [...WANTED, 'ppocr_keys_v1.txt']
  .map((name) => path.join(modelDir, name))
  .filter((file) => existsSync(file))
  .reduce((sum, file) => sum + readFileSync(file).length, 0)

console.log(`[setup:ocr] 完成，共 ${(total / 1048576).toFixed(1)}MB → ${modelDir}`)
