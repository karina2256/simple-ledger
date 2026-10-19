import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AppConfig } from '@shared/types'

const CONFIG_FILE = 'config.json'
const DB_FILE = 'daily-ledger.db'

let cached: AppConfig | null = null
let portableProbe: string | null | undefined

/**
 * 便携版的数据隔离。
 *
 * electron-builder 的 portable 目标会设置 PORTABLE_EXECUTABLE_DIR（= exe 所在目录）。
 * 检测到它就说明「这是免安装版」，于是把**引导文件与默认数据目录**放到 exe 同级，
 * 而不是 %APPDATA%。这样：
 *   - 用户在自己机器上双击便携版，不会误开系统里安装版的数据；
 *   - 发给别人的便携版，在任何机器上都是干净独立的一份（U 盘模式）。
 *
 * 如果 exe 所在目录不可写（比如放在 Program Files），退回 %APPDATA%，不让应用起不来。
 */
export function portableRoot(): string | null {
  if (portableProbe !== undefined) return portableProbe
  const dir = process.env['PORTABLE_EXECUTABLE_DIR']
  if (!dir || !dir.trim()) {
    portableProbe = null
    return portableProbe
  }
  try {
    const probe = path.join(dir, '.write-test')
    writeFileSync(probe, 'ok', 'utf-8')
    unlinkSync(probe)
    portableProbe = dir
  } catch {
    portableProbe = null
  }
  return portableProbe
}

/** 引导文件所在目录：便携版跟着 exe 走，安装版在 %APPDATA% */
function configDir(): string {
  // 自动化验证用的显式覆盖：便携版会优先认 exe 同级目录，
  // 导致 --user-data-dir 对它无效（那是 Chromium 的缓存目录，不是我们的配置目录）。
  // 这个口子让 verify:packaged 能把便携版也指到沙箱里。
  const override = process.env['LEDGER_CONFIG_DIR']
  if (override && override.trim()) return override
  return portableRoot() ?? app.getPath('userData')
}

/** 默认数据目录：便携版是 <exe 同级>\data，安装版是 %APPDATA%\daily-ledger\data */
export function defaultDataDir(): string {
  return path.join(configDir(), 'data')
}

function configPath(): string {
  return path.join(configDir(), CONFIG_FILE)
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** 读引导文件（独立于数据库，数据库搬走后仍能定位） */
export function readConfig(): AppConfig {
  if (cached) return cached
  const fallback: AppConfig = { initialized: false, dataDir: defaultDataDir() }
  try {
    const raw = readFileSync(configPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    cached = {
      initialized: Boolean(parsed.initialized),
      dataDir: typeof parsed.dataDir === 'string' && parsed.dataDir ? parsed.dataDir : fallback.dataDir
    }
  } catch {
    cached = fallback
  }
  return cached
}

export function writeConfig(patch: Partial<AppConfig>): AppConfig {
  const next: AppConfig = { ...readConfig(), ...patch }
  ensureDir(path.dirname(configPath()))
  writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  cached = next
  return next
}

export function getDataDir(): string {
  return readConfig().dataDir
}

export function dbPath(dataDir = getDataDir()): string {
  return path.join(dataDir, DB_FILE)
}

export function attachmentsDir(dataDir = getDataDir()): string {
  return path.join(dataDir, 'attachments')
}

export function backupDir(dataDir = getDataDir()): string {
  return path.join(dataDir, 'backup')
}

/**
 * 随包资源（图标等）的绝对路径。
 * 开发时读仓库里的 resources/，打包后读 electron-builder 复制到 resourcesPath 的那份。
 */
export function resourcePath(...parts: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, '../../resources', ...parts)
}
