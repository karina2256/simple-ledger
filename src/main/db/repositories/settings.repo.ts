import { getDb } from '../connection'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type { AppSettings, SettingKey } from '@shared/types'

function now(): number {
  return Date.now()
}

function readRaw(): Map<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  return new Map(rows.map((row) => [row.key, row.value]))
}

/** 读全部设置：以默认值为底，库里有值就覆盖 */
export function getAll(): AppSettings {
  const raw = readRaw()
  const result = structuredClone(DEFAULT_SETTINGS) as AppSettings
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
    const value = raw.get(key)
    if (value === undefined) continue
    try {
      ;(result as unknown as Record<string, unknown>)[key] = JSON.parse(value)
    } catch {
      /* 值损坏时保留默认，不让设置页整体挂掉 */
    }
  }
  return result
}

export function set<K extends SettingKey>(key: K, value: AppSettings[K]): AppSettings {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), now())
  return getAll()
}

export function setMany(patch: Partial<AppSettings>): AppSettings {
  const run = getDb().transaction((entries: [string, unknown][]) => {
    const stmt = getDb().prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    for (const [key, value] of entries) stmt.run(key, JSON.stringify(value), now())
  })
  run(Object.entries(patch) as [string, unknown][])
  return getAll()
}

export function reset(): AppSettings {
  getDb().prepare('DELETE FROM settings').run()
  return getAll()
}

export function hasSeedMark(): boolean {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = 'seeded'`).get() as
    | { value: string }
    | undefined
  return row !== undefined
}

export function markSeeded(): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('seeded', '1', ?)
       ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`
    )
    .run(now())
}
