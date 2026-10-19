/**
 * 账单截图导入的端到端验证。
 *
 * 为什么不用真图：仓库里不该放你的真实账单（隐私），而且图片识别本身依赖 OCR。
 * 所以这里做两件事：
 *   1. 用与你截图**同版式**的合成账单跑一遍完整链路：解析 → 核对 → 入库 → 去重；
 *   2. 断言逐笔字段、收支方向、日小计核对、重复导入被拦、标签与分类映射都正确。
 *
 * 用法：npm run verify:billshot
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const sandbox = path.join(root, '.tmp', 'billshot')
const userData = path.join(sandbox, 'userdata')
const dataDir = path.join(sandbox, 'data')

if (!existsSync(electronExe)) {
  console.error('找不到 Electron 可执行文件，请先执行 npm run setup')
  process.exit(1)
}
if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ initialized: true, dataDir }, null, 2), 'utf-8')

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

// 初始化数据库（跑一次引导写入）
const init = await runApp({ LEDGER_INIT_ONLY: '1' }, 20000)
if (init.timedOut) {
  console.error('初始化超时')
  process.exit(1)
}

const { buffer, code, timedOut } = await runApp({ LEDGER_BILLSHOT_PROBE: '1' }, 90000)
const lines = buffer
  .split(/\r?\n/)
  .filter((line) => line.includes('PASS') || line.includes('FAIL') || line.includes('账单截图验证'))
if (lines.length === 0) {
  console.error('探针没有输出，原始输出尾部：')
  console.error(buffer.slice(-3000))
  process.exit(1)
}
for (const line of lines) console.log(line.trim())
console.log('')

if (timedOut) {
  console.error('探针超时未结束，按失败处理')
  process.exit(1)
}
const failed = lines.filter((line) => line.includes('FAIL'))
// 顺带确认数据库里确实落了记录
const verify = spawnSync(
  electronExe,
  [path.join(root, 'scripts', 'verify-db.cjs'), path.join(dataDir, 'daily-ledger.db')],
  { encoding: 'utf-8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
)
if (verify.stdout) console.log(verify.stdout.trim())

process.exit(failed.length === 0 && code === 0 ? 0 : 1)
