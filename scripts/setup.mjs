/**
 * 一键准备好运行环境：
 *   1. 下载 Electron 运行时（直连 GitHub 失败时自动改用 npmmirror 镜像）
 *   2. 拉取与 Electron ABI 匹配的 better-sqlite3 预编译二进制
 *
 * 用法：npm install --ignore-scripts && npm run setup
 *
 * 说明：本项目刻意不用 npm 的 postinstall 做这两件事，因为它们依赖网络且失败原因各异，
 * 放在显式命令里，出错时能一眼看清是哪一步。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = path.join(root, 'node_modules', 'electron')
const electronExe = path.join(electronDir, 'dist', 'electron.exe')

if (!existsSync(electronDir)) {
  console.error('缺少 node_modules/electron，请先执行：npm install --ignore-scripts')
  process.exit(1)
}

if (!existsSync(electronExe)) {
  console.log('① 下载 Electron 运行时…')
  const installScript = path.join(electronDir, 'install.js')
  let result = spawnSync(process.execPath, [installScript], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.log('直连 GitHub 失败，改用 npmmirror 镜像重试…')
    result = spawnSync(process.execPath, [installScript], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/' }
    })
  }
  if (result.status !== 0) {
    console.error('Electron 运行时下载失败，请检查网络或代理设置')
    process.exit(1)
  }
} else {
  console.log('① Electron 运行时已就绪')
}

console.log('② 准备 better-sqlite3 预编译二进制…')
const native = spawnSync(process.execPath, [path.join(root, 'scripts', 'fetch-native.mjs')], { stdio: 'inherit' })
process.exit(native.status ?? 1)
