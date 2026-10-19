/**
 * 逐页冒烟：把构建产物真的跑起来，依次打开几个路由，
 * 收集渲染进程的 console 输出，报出其中的错误。
 *
 * 用法：npm run smoke:pages
 *
 * 说明：这不是替代你手点，而是保证「页面能挂载、没有未捕获异常、IPC 调得通」。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const sandbox = path.join(root, '.tmp', 'pagesmoke')
const userData = path.join(sandbox, 'userdata')
const dataDir = path.join(sandbox, 'data')
// 允许 --shots <目录> 指定截图输出位置（npm run shots 会写进 docs/screenshots）
const shotsArg = process.argv.indexOf('--shots')
const shotDir =
  shotsArg >= 0 && process.argv[shotsArg + 1]
    ? path.resolve(root, process.argv[shotsArg + 1])
    : path.join(sandbox, 'shots')

// 用「今天」当锚点，这样示例数据（最近 12 个月）正好落在视图里；
// 日视图锚到本月 1 号——那天一定有房租这笔，能顺带验证流水与周期标记
const now = new Date()
const pad = (value) => String(value).padStart(2, '0')
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const firstOfMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`

const ROUTES = [
  '/records',
  '/billshot',
  `/calendar?view=year&date=${today}`,
  `/calendar?view=month&date=${today}`,
  `/calendar?view=week&date=${today}`,
  `/calendar?view=day&date=${firstOfMonth}`,
  '/stats',
  '/search',
  '/budgets',
  '/recurring',
  '/accounts',
  '/categories',
  '/recycle',
  '/settings'
]

// 打包/构建产物里这些属于 Chromium 自己的噪音，不算页面错误
const IGNORE = [
  'Electron Security Warning',
  'Insecure Content-Security-Policy',
  'DevTools',
  'Autofill',
  'Request Autofill',
  'libpng'
]

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

function runApp(env, timeout = 7000) {
  return new Promise((resolve) => {
    const child = spawn(
      electronExe,
      [path.join(root, 'out', 'main', 'index.js'), `--user-data-dir=${userData}`, '--enable-logging'],
      { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let buffer = ''
    child.stdout.on('data', (chunk) => (buffer += chunk.toString()))
    child.stderr.on('data', (chunk) => (buffer += chunk.toString()))
    setTimeout(() => {
      child.kill()
      resolve(buffer)
    }, timeout)
  })
}

// 先灌一份示例数据，这样截图与探针看到的是有内容的日历
const seedOutput = await runApp({ LEDGER_SEED_DEMO: '1' }, 5000)
console.log(seedOutput.split(/\r?\n/).find((line) => line.includes('[seed-demo]')) ?? '[seed-demo] （无输出）')
console.log('')

/** 直接改库里的设置（用来切深浅色截图） */
function setSetting(key, jsonValue) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  spawnSync(electronExe, [path.join(root, 'scripts', 'db-set.cjs'), path.join(dataDir, 'daily-ledger.db'), key, jsonValue], {
    stdio: 'inherit',
    env
  })
}

function runRoute(route, opts = {}) {
  const base = route.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'root'
  const dark = opts.dark === true
  const slug = dark ? `dark_${base}` : base
  return new Promise((resolve) => {
    const child = spawn(
      electronExe,
      [path.join(root, 'out', 'main', 'index.js'), `--user-data-dir=${userData}`, '--enable-logging'],
      {
        env: {
          ...process.env,
          LEDGER_START_ROUTE: route,
          LEDGER_PAGE_PROBE: '1',
          LEDGER_PROBE_DIR: shotDir,
          LEDGER_PROBE_NAME: slug
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )

    let buffer = ''
    child.stdout.on('data', (chunk) => (buffer += chunk.toString()))
    child.stderr.on('data', (chunk) => (buffer += chunk.toString()))

    setTimeout(() => {
      child.kill()
      const raw = buffer.split(/\r?\n/)
      const lines = raw
        .filter((line) => line.includes('CONSOLE'))
        .filter((line) => !IGNORE.some((token) => line.includes(token)))
      const probeLine = raw.find((line) => line.includes('[page-probe]')) ?? ''
      let probe = null
      try {
        probe = JSON.parse(probeLine.slice(probeLine.indexOf('{')))
      } catch {
        probe = null
      }
      resolve({ lines, probe, slug })
    }, 9000)
  })
}

const report = []
for (const route of ROUTES) {
  const { lines, probe, slug } = await runRoute(route)
  const rendered = Boolean(probe && probe.nodes > 0 && probe.main && probe.main.length > 0)
  report.push({ route, lines, probe, rendered, slug })
  console.log(
    `${lines.length === 0 && rendered ? 'CLEAN' : 'CHECK'}  ${route}  ` +
      `内容 “${probe?.main ?? '（探针无输出）'}”`
  )
  for (const line of lines) console.log(`        ${line.trim().slice(0, 220)}`)
}

// 再跑一遍深色模式：日历三色对比度是这轮的验收项之一，留两张图给你对照
console.log('\n切换到深色模式，重拍日历四视图…')
setSetting('theme', '"dark"')
for (const route of ROUTES.filter((item) => item.startsWith('/calendar'))) {
  const { lines, probe, slug } = await runRoute(route, { dark: true })
  const rendered = Boolean(probe && probe.nodes > 0 && probe.main && probe.main.length > 0)
  report.push({ route: `${route}（深色）`, lines, probe, rendered, slug })
  console.log(
    `${lines.length === 0 && rendered ? 'CLEAN' : 'CHECK'}  ${route}（深色） 内容 “${probe?.main ?? '（探针无输出）'}”`
  )
  for (const line of lines) console.log(`        ${line.trim().slice(0, 220)}`)
}
setSetting('theme', '"light"')

console.log(`\n截图目录：${shotDir}`)
const noisy = report.filter((item) => item.lines.length > 0 || !item.rendered)
console.log(`===== 页面冒烟：${report.length - noisy.length}/${report.length} 干净且渲染出内容 =====\n`)
process.exit(noisy.length === 0 ? 0 : 1)
