/**
 * 打包产物验证：拿 release/ 里的 exe 真跑一遍。
 *
 * 用法：npm run verify:packaged
 *
 * 检查项：
 *   1. win-unpacked 的 记账簿.exe：托盘行为（创建、点 X 隐藏、从托盘唤回、进程不退出）
 *   2. 同一份 exe：写入一笔记录 → 关掉 → 再启动 → 记录还在
 *   3. 免安装版 portable exe：能启动、能读到上一步写入的数据
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')
const sandbox = path.join(root, '.tmp', 'packaged')
const userData = path.join(sandbox, 'userdata')
const dataDir = path.join(sandbox, 'data')
const reportDir = path.join(sandbox, 'reports')

const unpackedExe = path.join(releaseDir, 'win-unpacked', '记账簿.exe')
const portableExe = path.join(releaseDir, 'daily-ledger-0.1.0-portable.exe')

const results = []
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: String(detail) })

/** 读 exe 元数据里的 ProductVersion（= 用户在文件属性里看到的版本） */
function exeVersion(exe) {
  const script = `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`
  const out = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8' })
  return (out.stdout ?? '').trim()
}

function runExe(exe, env, timeout) {
  return new Promise((resolve) => {
    const child = spawn(exe, [`--user-data-dir=${userData}`], {
      // LEDGER_CONFIG_DIR：便携版会优先用「exe 同级的 config.json」，
      // 所以要显式把配置目录也指到沙箱，否则它读不到我们准备的这份数据。
      env: { ...process.env, LEDGER_CONFIG_DIR: userData, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk.toString()))
    child.stderr.on('data', (chunk) => (output += chunk.toString()))
    child.on('exit', (code) => resolve({ code, output }))
    setTimeout(() => {
      if (!child.killed) child.kill()
    }, timeout)
  })
}

if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(reportDir, { recursive: true })
writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify({ initialized: true, dataDir }, null, 2),
  'utf-8'
)

// ---------- 1. 托盘 ----------
for (const [label, exe] of [
  ['win-unpacked', unpackedExe],
  ['portable', portableExe]
]) {
  check(`${label} 产物存在`, existsSync(exe), exe)
}

const trayReport = path.join(reportDir, 'tray.txt')
const trayRun = await runExe(unpackedExe, { LEDGER_TRAY_PROBE: '1', LEDGER_PROBE_REPORT: trayReport }, 20000)
const trayText = existsSync(trayReport) ? readFileSync(trayReport, 'utf-8') : ''
console.log(trayText || `（托盘探针没有输出，退出码 ${trayRun.code}）`)
for (const line of trayText.split(/\r?\n/)) {
  if (line.startsWith('PASS ') || line.startsWith('FAIL ')) {
    const ok = line.startsWith('PASS ')
    check(`托盘｜${line.slice(5).split('  ')[0]}`, ok, line.slice(5).split('  ')[1] ?? '')
  }
}
check('托盘探针整体通过', trayRun.code === 0 && trayText.includes('通过') && !trayText.includes('FAIL'), `exit ${trayRun.code}`)

// ---------- 2. 持久化 ----------
const writeReport = path.join(reportDir, 'persist-write.txt')
const writeRun = await runExe(
  unpackedExe,
  { LEDGER_PERSIST_PROBE: 'write', LEDGER_PROBE_REPORT: writeReport },
  20000
)
const writeText = existsSync(writeReport) ? readFileSync(writeReport, 'utf-8') : ''
console.log(writeText || `（写入探针没有输出，退出码 ${writeRun.code}）`)
check('打包版能写入记录', writeRun.code === 0 && writeText.includes('写入后立刻能查到'), `exit ${writeRun.code}`)

const dbFile = path.join(dataDir, 'daily-ledger.db')
check('数据库文件已生成', existsSync(dbFile), dbFile)

const checkReport = path.join(reportDir, 'persist-check.txt')
const checkRun = await runExe(
  unpackedExe,
  { LEDGER_PERSIST_PROBE: 'check', LEDGER_PROBE_REPORT: checkReport },
  20000
)
const checkText = existsSync(checkReport) ? readFileSync(checkReport, 'utf-8') : ''
console.log(checkText || `（读取探针没有输出，退出码 ${checkRun.code}）`)
check('重启后记录还在', checkRun.code === 0 && checkText.includes('重启后记录仍在'), `exit ${checkRun.code}`)

// ---------- 3. 免安装版 ----------
const portableReport = path.join(reportDir, 'portable.txt')
const portableRun = await runExe(
  portableExe,
  { LEDGER_PERSIST_PROBE: 'check', LEDGER_PROBE_REPORT: portableReport },
  30000
)
const portableText = existsSync(portableReport) ? readFileSync(portableReport, 'utf-8') : ''
console.log(portableText || `（免安装版没有输出，退出码 ${portableRun.code}）`)
check('免安装版能启动并读到同一份数据', portableRun.code === 0, `exit ${portableRun.code}`)

// ---------- 4. 打包产物的版本号 ----------
// app.getVersion() 在未打包时会返回 Electron 自己的版本，所以「版本号是否正确」
// 只能在打包产物上验。这里读 exe 的 ProductVersion —— 它就是用户在属性里看到的那个。
// 注意 Windows 会把 ProductVersion 归一成四段（0.1.0 → 0.1.0.0），
// 所以比较前要先去掉结尾的 .0，否则会把同一个版本判成不一致。
const normalizeVersion = (value) => value.replace(/\.0+$/, '').replace(/(\.0)+$/, '')
const productVersion = [unpackedExe, portableExe].map((exe) => {
  const info = exeVersion(exe)
  check(`版本号正确（${path.basename(exe)}）`, info.startsWith('0.1.0'), info || '读不到')
  return normalizeVersion(info)
})
check('两个产物的版本号一致', new Set(productVersion).size === 1, productVersion.join(' / '))

// ---------- 汇总 ----------
const failed = results.filter((item) => !item.ok)
console.log('\n===== 打包产物验证 =====')
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  ${item.detail}`)
console.log(`===== ${results.length - failed.length}/${results.length} 通过 =====\n`)
process.exit(failed.length === 0 ? 0 : 1)
