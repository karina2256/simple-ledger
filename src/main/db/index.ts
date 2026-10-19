import { openDatabase, integrityCheck, isOpen } from './connection'
import { runMigrations } from './migrations'
import { seedIfNeeded, type SeedMode } from './seed'
import { dbPath, ensureDir } from '../paths'

export interface InitResult {
  dbPath: string
  migratedFrom: number
  migratedTo: number
  seeded: boolean
  integrityError: string | null
}

/** 打开数据库 → 迁移 → 首次写入初始内容 → 完整性校验 */
export function initDatabase(dataDir: string, seedMode: SeedMode = 'template'): InitResult {
  ensureDir(dataDir)
  const file = dbPath(dataDir)
  const db = openDatabase(file)
  const migration = runMigrations(db)
  const seeded = seedIfNeeded(seedMode)
  const integrityError = integrityCheck()
  return {
    dbPath: file,
    migratedFrom: migration.from,
    migratedTo: migration.to,
    seeded,
    integrityError
  }
}

export { integrityCheck, isOpen }
