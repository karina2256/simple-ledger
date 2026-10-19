/**
 * 动效验证：把构建产物跑起来，让主进程里的动效探针把结果打印出来。
 *
 * 用法：npm run verify:motion
 *
 * 截图只能证明「渲染出来了」，证明不了动效；这个脚本断言的是：
 * 进场动画真的触发、播完都回到终态（不会把内容卡在半透明）、
 * 弹窗进场是位移+缩放而不是只淡入、退场也播完才卸载、
 * 校验失败会抖动、成功有对勾描线、金额是逐帧滚上去的，
 * 以及系统开「减少动态效果」时动画被压到 0。
 *
 * 全程用 .tmp/motionprobe 下的临时数据目录，并会真写一笔 12.34 元的记录。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const sandbox = path.join(root, '.tmp', 'motionprobe')
const userData = path.join(sandbox, 'userdata')
const dataDir = path.join(sandbox, 'data')

if (!existsSync(electronExe)) {
  console.error('找不到 Electron 可执行文件，请先执行 npm run setup')
  process.exit(1)
}

if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify({ initialized: true, dataDir }, null, 2),
  'utf-8'
)

/** 用固定环境把应用跑一次，返回合并后的输出；超时则杀进程（探针卡住时要能失败而不是挂着） */
function runApp(env, timeout) {
  return new Promise((resolve) => {
    const child = spawn(
      electronExe,
      [path.join(root, 'out', 'main', 'index.js'), `--user-data-dir=${userData}`, '--enable-logging'],
      { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let buffer = ''
    const collect = (chunk) => (buffer += chunk.toString())
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      child.kill()
      resolve({ buffer, timedOut: true })
    }, timeout)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ buffer, code, timedOut: false })
    })
  })
}

// 先灌示例数据，让记录页有表格行可以看错峰入场
const seed = await runApp({ LEDGER_SEED_DEMO: '1' }, 15000)
console.log(seed.buffer.split(/\r?\n/).find((line) => line.includes('[seed-demo]')) ?? '[seed-demo] （无输出）')

const { buffer, code, timedOut } = await runApp(
  {
    LEDGER_MOTION_PROBE: '1',
    LEDGER_START_ROUTE: '/records',
    // 顺手留下三张动效证据图：弹窗进场 / 校验失败 / 记账成功
    LEDGER_MOTION_SHOT_DIR: path.join(root, 'docs', 'screenshots')
  },
  90000
)

const lines = buffer.split(/\r?\n/).filter((line) => line.includes('PASS') || line.includes('FAIL') || line.includes('动效探针'))
if (lines.length === 0) {
  console.error('探针没有输出结果，原始输出：')
  console.error(buffer.slice(-4000))
  process.exit(1)
}

for (const line of lines) console.log(line.trim())
console.log('')

if (timedOut) {
  console.error('探针超时未结束，按失败处理')
  process.exit(1)
}

const failed = lines.filter((line) => line.includes('FAIL'))
process.exit(failed.length === 0 && code === 0 ? 0 : 1)
