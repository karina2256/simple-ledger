/**
 * 拉取与当前 Electron 版本 ABI 匹配的 better-sqlite3 预编译二进制。
 *
 * 为什么需要它：这台机器上没有可用的 MSVC 工具链（只有 VS 18，node-gyp 9 认不出来），
 * better-sqlite3 的源码编译会失败。而 better-sqlite3 官方为每个 Electron ABI 都发布了
 * 预编译包，直接下载放进 node_modules/better-sqlite3/build/Release 即可，不需要编译器。
 *
 * 用法：node scripts/fetch-native.mjs
 *   可选环境变量 ELECTRON_MIRROR / BS3_MIRROR，用于走镜像站加速。
 */
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const bs3Dir = path.join(root, 'node_modules', 'better-sqlite3')

const electronVersion = JSON.parse(
  readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf-8')
).version
const bs3Version = JSON.parse(readFileSync(path.join(bs3Dir, 'package.json'), 'utf-8')).version

// Electron 版本 → ABI，用 node-abi（prebuild-install 的依赖）换算，避免手写映射表
const { getAbi } = await import('node-abi').catch(() => ({
  getAbi: () => {
    throw new Error('缺少 node-abi，请先 npm install')
  }
}))
const abi = getAbi(electronVersion, 'electron')

const bs3Mirror = process.env.BS3_MIRROR ?? 'https://github.com/WiseLibs/better-sqlite3/releases/download'
const fileName = `better-sqlite3-v${bs3Version}-electron-v${abi}-win32-x64.tar.gz`
const url = `${bs3Mirror}/v${bs3Version}/${fileName}`

const target = path.join(bs3Dir, 'build', 'Release', 'better_sqlite3.node')
if (existsSync(target)) {
  console.log(`已存在：${path.relative(root, target)}（如需重新下载先删除该文件）`)
  process.exit(0)
}

const tmpFile = path.join(root, '.tmp', fileName)
mkdirSync(path.dirname(tmpFile), { recursive: true })

console.log(`Electron ${electronVersion} → ABI ${abi}`)
console.log(`better-sqlite3 ${bs3Version}`)
console.log(`下载 ${url}`)

const response = await fetch(url)
if (!response.ok) {
  console.error(`下载失败：HTTP ${response.status}`)
  process.exit(1)
}
await pipeline(response.body, createWriteStream(tmpFile))
console.log(`已下载 ${(statSync(tmpFile).size / 1024 / 1024).toFixed(2)} MB，正在解压…`)

mkdirSync(path.join(bs3Dir, 'build', 'Release'), { recursive: true })
execFileSync('tar', ['-xzf', tmpFile, '-C', bs3Dir], { stdio: 'inherit' })
rmSync(tmpFile, { force: true })

if (!existsSync(target)) {
  console.error('解压后没有找到 better_sqlite3.node，请检查包内容')
  process.exit(1)
}
console.log(`完成：${path.relative(root, target)}`)
