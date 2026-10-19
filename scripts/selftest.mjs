/**
 * 数据层自检入口：用真实的 Electron 主进程跑一遍「增删改查 + 余额口径」，
 * 结果直接打印到控制台，通过返回码 0，失败返回 1。
 *
 * 用法：npm run selftest
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

if (!existsSync(electronExe)) {
  console.error(`找不到 Electron 可执行文件：${electronExe}`)
  console.error('请先执行：npm install && node node_modules/electron/install.js')
  process.exit(1)
}

const sandbox = path.join(root, '.tmp', 'selftest')
if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
const userData = path.join(sandbox, 'userdata')
const dataDir = path.join(sandbox, 'data')
mkdirSync(userData, { recursive: true })

writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify({ initialized: true, dataDir }, null, 2),
  'utf-8'
)

const result = spawnSync(electronExe, [path.join(root, 'out', 'main', 'index.js'), `--user-data-dir=${userData}`], {
  stdio: 'inherit',
  env: { ...process.env, LEDGER_SELFTEST: '1' }
})

process.exit(result.status ?? 1)
