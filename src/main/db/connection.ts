import Database from 'better-sqlite3'
import { ensureDir } from '../paths'
import path from 'node:path'

let db: Database.Database | null = null
let currentFile = ''

/**
 * 打开数据库并设置 PRAGMA。
 * journal_mode=WAL + synchronous=FULL：每次事务提交即 fsync，满足「写入立即落盘」。
 */
export function openDatabase(file: string): Database.Database {
  if (db && currentFile === file) return db
  closeDatabase()
  ensureDir(path.dirname(file))
  const instance = new Database(file)
  instance.pragma('journal_mode = WAL')
  instance.pragma('synchronous = FULL')
  instance.pragma('foreign_keys = ON')
  instance.pragma('busy_timeout = 5000')
  db = instance
  currentFile = file
  return instance
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库尚未打开')
  return db
}

export function isOpen(): boolean {
  return db !== null
}

export function currentDatabaseFile(): string {
  return currentFile
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      /* 关闭失败不阻塞退出 */
    }
    db.close()
    db = null
    currentFile = ''
  }
}

/** 启动完整性校验，返回 null 表示正常 */
export function integrityCheck(): string | null {
  const instance = getDb()
  const rows = instance.pragma('quick_check') as { quick_check: string }[]
  const result = rows[0]?.quick_check ?? 'unknown'
  if (result !== 'ok') return result
  const fk = instance.pragma('foreign_key_check') as unknown[]
  if (fk.length > 0) return `存在 ${fk.length} 条外键异常`
  return null
}

/** 把 WAL 落盘，便于备份时直接复制主文件 */
export function checkpoint(): void {
  if (!db) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* ignore */
  }
}
