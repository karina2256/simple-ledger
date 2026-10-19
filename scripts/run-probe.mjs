/**
 * 通用探针运行器：在临时数据目录里把某个自检跑起来。
 *
 * 用法：node scripts/run-probe.mjs <环境变量名> [超时秒数]
 * 例：  node scripts/run-probe.mjs LEDGER_EXCHANGE_PROBE
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const probeEnv = process.argv[2]
const timeoutSec = Number(process.argv[3] ?? 180)

if (!probeEnv) {
  console.error('用法：node scripts/run-probe.mjs <环境变量名> [超时秒数]')
  process.exit(1)
}
if (!existsSync(electronExe)) {
  console.error('找不到 Electron，请先执行 npm run setup')
  process.exit(1)
}

const sandbox = path.join(root, '.tmp', probeEnv.toLowerCase())
const userData = path.join(sandbox, 'userdata')
const dataDir = path.join(sandbox, 'data')
rmSync(sandbox, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ initialized: true, dataDir }, null, 2), 'utf-8')

const child = spawn(electronExe, [path.join(root, 'out', 'main', 'index.js'), `--user-data-dir=${userData}`], {
  env: { ...process.env, [probeEnv]: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
})
let buffer = ''
child.stdout.on('data', (c) => { buffer += c.toString() })
child.stderr.on('data', (c) => { buffer += c.toString() })
const timer = setTimeout(() => { child.kill(); console.error('探针超时'); process.exit(1) }, timeoutSec * 1000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const lines = buffer.split(/\r?\n/).filter((line) => /^(PASS|FAIL)|验证|=====/.test(line.trim()))
  for (const line of lines) console.log(line)
  if (lines.length === 0) console.error(buffer.slice(-2000))
  process.exit(code ?? 1)
})
