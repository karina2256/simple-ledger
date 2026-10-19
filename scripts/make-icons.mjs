/**
 * 生成应用图标与托盘图标（记账主题：青绿底 + 账本页 + 三条账目线 + 一枚硬币）。
 *
 * 用法：node scripts/make-icons.mjs
 *
 * 不依赖任何图形库：手写 PNG 编码（zlib + CRC32），再打包成多尺寸 ICO。
 * 尺寸先按 4 倍超采样绘制，再取平均降采样，边缘不毛糙。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const iconDir = path.join(root, 'resources', 'icons')
const buildDir = path.join(root, 'build')

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** rgba: Uint8Array，长度 = size*size*4 */
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- 绘制 ----------
const SUPERSAMPLE = 4

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

const TEAL = hexToRgb('#2E9E93')
const WHITE = [255, 255, 255]
const LINE = hexToRgb('#8FC4BE')
const COIN = hexToRgb('#E8A33D')

function inRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = Math.min(Math.max(x, left + radius), right - radius)
  const cy = Math.min(Math.max(y, top + radius), bottom - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/** 返回某个采样点的颜色（[r,g,b,a]），坐标是 0..1 的相对值 */
function sample(u, v) {
  // 底：圆角方块
  if (!inRoundedRect(u, v, 0.02, 0.02, 0.98, 0.98, 0.22)) return [0, 0, 0, 0]

  // 账本页
  if (inRoundedRect(u, v, 0.2, 0.13, 0.8, 0.87, 0.07)) {
    // 三条账目线
    const lines = [
      { y: 0.3, x2: 0.68 },
      { y: 0.44, x2: 0.62 },
      { y: 0.58, x2: 0.66 }
    ]
    for (const line of lines) {
      if (inRoundedRect(u, v, 0.3, line.y - 0.028, line.x2, line.y + 0.028, 0.028)) {
        return [...LINE, 255]
      }
    }
    // 硬币
    if (inCircle(u, v, 0.68, 0.72, 0.15)) return [...COIN, 255]
    return [...WHITE, 255]
  }

  return [...TEAL, 255]
}

function renderRgba(size) {
  const big = size * SUPERSAMPLE
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const u = (x * SUPERSAMPLE + sx + 0.5) / big
          const v = (y * SUPERSAMPLE + sy + 0.5) / big
          const [cr, cg, cb, ca] = sample(u, v)
          const alpha = ca / 255
          r += cr * alpha
          g += cg * alpha
          b += cb * alpha
          a += ca
        }
      }
      const count = SUPERSAMPLE * SUPERSAMPLE
      const alphaAvg = a / count
      const index = (y * size + x) * 4
      // 预乘还原
      const scale = alphaAvg > 0 ? count * (alphaAvg / 255) : 1
      out[index] = Math.round(r / scale)
      out[index + 1] = Math.round(g / scale)
      out[index + 2] = Math.round(b / scale)
      out[index + 3] = Math.round(alphaAvg)
    }
  }
  return out
}

// ---------- ICO 打包（PNG 压缩条目，Vista 以上支持） ----------
function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)

  let offset = 6 + pngs.length * 16
  const entries = []
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32BE(0, 8)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }

  return Buffer.concat([header, ...entries, ...pngs.map((item) => item.data)])
}

// ---------- 输出 ----------
mkdirSync(iconDir, { recursive: true })
mkdirSync(buildDir, { recursive: true })

const APP_SIZES = [16, 24, 32, 48, 64, 128, 256]
const TRAY_SIZES = [16, 24, 32]

const appPngs = APP_SIZES.map((size) => ({ size, data: encodePng(renderRgba(size), size) }))
const trayPngs = TRAY_SIZES.map((size) => ({ size, data: encodePng(renderRgba(size), size) }))

const appIco = buildIco(appPngs)
const trayIco = buildIco(trayPngs)

writeFileSync(path.join(iconDir, 'icon.ico'), appIco)
writeFileSync(path.join(buildDir, 'icon.ico'), appIco)
writeFileSync(path.join(iconDir, 'tray.ico'), trayIco)
writeFileSync(path.join(iconDir, 'icon.png'), appPngs[appPngs.length - 1].data)
writeFileSync(path.join(iconDir, 'tray.png'), trayPngs[1].data)
writeFileSync(path.join(iconDir, 'tray@2x.png'), trayPngs[2].data)

console.log(`应用图标：${path.join(iconDir, 'icon.ico')}（${APP_SIZES.join('/')}）`)
console.log(`托盘图标：${path.join(iconDir, 'tray.ico')}（${TRAY_SIZES.join('/')}）`)
console.log(`安装包图标：${path.join(buildDir, 'icon.ico')}`)
console.log('预览图：resources/icons/icon.png')
