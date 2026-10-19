/**
 * 用 Electron 自带的 Node 跑升级路径验证（better-sqlite3 是按 Electron ABI 编译的，
 * 普通 Node 加载不了）。
 *
 * 用法：npm run verify:upgrade
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

const result = spawnSync(electronExe, [path.join(root, 'scripts', 'verify-upgrade.cjs')], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

process.exit(result.status ?? 1)
