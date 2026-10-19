/**
 * 往当前数据目录里写入一份示例数据（可选功能）。
 *
 * 用法：npm run seed:demo
 *
 * 注意：写的是你正在用的那份数据（默认 %APPDATA%\daily-ledger\config.json 里记录的数据目录）。
 * 只在没有任何示例数据标记时写入一次，重复执行不会重复灌数据。
 * 建议先在应用里完成首次启动引导，再跑这个命令。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

if (!existsSync(electronExe)) {
  console.error('找不到 Electron 可执行文件，请先执行 npm run setup')
  process.exit(1)
}

const result = spawnSync(electronExe, [path.join(root, 'out', 'main', 'index.js')], {
  stdio: 'inherit',
  env: { ...process.env, LEDGER_SEED_DEMO: '1' }
})

if (result.status !== 0) {
  console.error('\n如果提示「数据库尚未初始化」，请先运行 npm run dev，完成首次启动引导后再试。')
}

process.exit(result.status ?? 1)
