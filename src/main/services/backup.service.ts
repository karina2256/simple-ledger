import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { backupDir, dbPath, ensureDir, getDataDir } from '../paths'
import { checkpoint } from '../db/connection'
import type { BackupInfo, BackupResult } from '@shared/types'

const PREFIX = 'daily-ledger-'
const SUFFIX = '.db'

export function timestamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/** 手动备份：先 checkpoint 把 WAL 落盘，再复制主库文件 */
export function backupNow(): BackupResult {
  const source = dbPath(getDataDir())
  if (!existsSync(source)) return { ok: false, message: '数据库文件不存在' }
  try {
    checkpoint()
    const dir = backupDir(getDataDir())
    ensureDir(dir)
    const target = path.join(dir, `${PREFIX}${timestamp()}${SUFFIX}`)
    copyFileSync(source, target)
    return { ok: true, filePath: target }
  } catch (error) {
    return { ok: false, message: `备份失败：${String(error)}` }
  }
}

/** 已有的备份文件，按时间从新到旧 */
function listBackupFiles(): { file: string; at: number; size: number }[] {
  const dir = backupDir(getDataDir())
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .map((name) => {
      const full = path.join(dir, name)
      const stat = statSync(full)
      return { file: full, at: stat.mtimeMs, size: stat.size }
    })
    .sort((a, b) => b.at - a.at)
}

/** 备份现状：设置页用来显示「上次备份 / 共几份 / 占多少」 */
export function backupInfo(): BackupInfo {
  const files = listBackupFiles()
  return {
    dir: backupDir(getDataDir()),
    count: files.length,
    lastAt: files[0]?.at ?? null,
    lastPath: files[0]?.file ?? null,
    totalBytes: files.reduce((sum, item) => sum + item.size, 0)
  }
}

/** 只保留最近 keep 份，多出来的按时间从旧到新删掉 */
export function pruneBackups(keep: number): number {
  const limit = Math.max(1, Math.floor(keep))
  const files = listBackupFiles()
  let removed = 0
  for (const item of files.slice(limit)) {
    try {
      unlinkSync(item.file)
      removed += 1
    } catch {
      /* 删不掉就算了，别影响启动 */
    }
  }
  return removed
}

const DAY_MS = 86400000

/**
 * 自动备份：启动时检查一次，到期就备份并清理旧份。
 *
 * 为什么放在启动而不是退出：崩溃/断电时退出钩子不一定跑得到，
 * 而启动成功说明上次的数据至少是完好的，这时候留档最稳。
 */
export function autoBackupIfDue(mode: 'off' | 'daily' | 'weekly', keep: number): BackupResult | null {
  if (mode === 'off') return null
  const interval = mode === 'daily' ? DAY_MS : DAY_MS * 7
  const info = backupInfo()
  if (info.lastAt !== null && Date.now() - info.lastAt < interval) return null

  const result = backupNow()
  if (result.ok) {
    const removed = pruneBackups(keep)
    console.log(
      `[backup] 自动备份完成：${path.basename(result.filePath ?? '')}` + (removed > 0 ? `，清理旧备份 ${removed} 份` : '')
    )
  } else {
    console.error(`[backup] 自动备份失败：${result.message}`)
  }
  return result
}

/** 便携版可能把数据放在只读位置，这里给设置页一个可读的说明 */
export function ensureBackupDir(): void {
  mkdirSync(backupDir(getDataDir()), { recursive: true })
}
