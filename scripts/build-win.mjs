/**
 * 打包 Windows 安装包与免安装版。
 *
 * 用法：npm run build:win
 *
 * 这台机器直连 GitHub 下载 electron-builder 的工具链（nsis / wix / winCodeSign）会超时，
 * 所以默认走 npmmirror 镜像；需要时用 ELECTRON_BUILDER_BINARIES_MIRROR 覆盖。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const builderPkg = JSON.parse(
  readFileSync(path.join(root, 'node_modules', 'electron-builder', 'package.json'), 'utf-8')
)
const binRel = typeof builderPkg.bin === 'string' ? builderPkg.bin : builderPkg.bin['electron-builder']
const binPath = path.join(root, 'node_modules', 'electron-builder', binRel)

if (!existsSync(binPath)) {
  console.error('找不到 electron-builder，请先执行 npm install --ignore-scripts 与 npm run setup')
  process.exit(1)
}

const env = {
  ...process.env,
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ?? 'https://npmmirror.com/mirrors/electron-builder-binaries/'
}

console.log('开始打包（nsis + msi + portable，x64）…')
const result = spawnSync(process.execPath, [binPath, '--win'], { stdio: 'inherit', cwd: root, env })

if ((result.status ?? 1) !== 0) {
  console.error('\n打包失败。若是下载工具链超时，可先设置镜像后重试：')
  console.error('  $env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"')
  process.exit(result.status ?? 1)
}

console.log('\n打包完成，产物在 release/')
