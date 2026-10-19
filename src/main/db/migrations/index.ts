import type { Database } from 'better-sqlite3'
import { migration001 } from './001_init'
import { migration002 } from './002_account_archive'
import { migration003 } from './003_category_archive'

export interface Migration {
  version: number
  name: string
  /** 需要在 foreign_keys=OFF 下执行（建表 / 重建表 / 换约束时用） */
  foreignKeysOff?: boolean
  up: (db: Database) => void
}

/** 顺序追加，只升不降。已发布过的迁移不要再改内容 */
export const migrations: Migration[] = [migration001, migration002, migration003]

export function runMigrations(db: Database): { from: number; to: number } {
  const from = db.pragma('user_version', { simple: true }) as number
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version)
  if (pending.length === 0) return { from, to: from }

  for (const migration of pending) {
    // PRAGMA foreign_keys 在事务里是空操作，必须在 BEGIN 之前设置
    if (migration.foreignKeysOff) db.pragma('foreign_keys = OFF')
    try {
      const apply = db.transaction(() => {
        migration.up(db)
        db.pragma(`user_version = ${migration.version}`)
      })
      apply()
    } finally {
      if (migration.foreignKeysOff) db.pragma('foreign_keys = ON')
    }

    if (migration.foreignKeysOff) {
      const violations = db.pragma('foreign_key_check') as unknown[]
      if (violations.length > 0) {
        throw new Error(`迁移 ${migration.version} 之后外键校验不通过，共 ${violations.length} 处异常`)
      }
    }
  }

  const to = db.pragma('user_version', { simple: true }) as number
  return { from, to }
}
