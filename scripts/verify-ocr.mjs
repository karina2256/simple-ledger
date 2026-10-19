import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const images = process.argv.slice(2)
if (images.length === 0) {
  console.error('用法：npm run verify:ocr -- <图片路径…>')
  process.exit(1)
}
if (!existsSync(electronExe)) {
  console.error('找不到 Electron，请先执行 npm run setup')
  process.exit(1)
}

const child = spawn(electronExe, [path.join(root, 'out', 'main', 'index.js')], {
  env: { ...process.env, LEDGER_OCR_PROBE: images.map((p) => path.resolve(p)).join(';') },
  stdio: ['ignore', 'pipe', 'pipe']
})
let buffer = ''
child.stdout.on('data', (chunk) => { buffer += chunk.toString() })
child.stderr.on('data', (chunk) => { buffer += chunk.toString() })
child.on('exit', (code) => {
  const lines = buffer.split(/\r?\n/).filter((line) => line.startsWith('[ocr]'))
  for (const line of lines) console.log(line)
  process.exit(code ?? 1)
})
