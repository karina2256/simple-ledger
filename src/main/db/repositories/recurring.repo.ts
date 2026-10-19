import { randomUUID } from 'node:crypto'
import { getDb } from '../connection'
import { nextOccurrence } from '@shared/recurring'
import { todayKey } from '@shared/date'
import type { Frequency, RecurringInput, RecurringRule, RecordType, WriteResult } from '@shared/types'

interface Row {
  id: string
  name: string
  amount: number
  type: RecordType
  category_id: string | null
  account_id: string | null
  to_account_id: string | null
  frequency: Frequency
  interval: number
  start_date: string
  end_date: string | null
  next_date: string
  enabled: number
  created_at: number
  updated_at: number
}

function map(row: Row): RecurringRule {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    type: row.type,
    categoryId: row.category_id,
    accountId: row.account_id,
    toAccountId: row.to_account_id,
    frequency: row.frequency,
    interval: row.interval,
    startDate: row.start_date,
    endDate: row.end_date,
    nextDate: row.next_date,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function list(onlyEnabled = false): RecurringRule[] {
  const sql = `SELECT * FROM recurring${onlyEnabled ? ' WHERE enabled = 1' : ''} ORDER BY enabled DESC, start_date, created_at`
  return (getDb().prepare(sql).all() as Row[]).map(map)
}

export function get(id: string): RecurringRule | null {
  const row = getDb().prepare('SELECT * FROM recurring WHERE id = ?').get(id) as Row | undefined
  return row ? map(row) : null
}

/** next_date 只是缓存：存库时按 start_date 推一次，供列表显示 */
function computeNextDate(input: RecurringInput): string {
  const guess = nextOccurrence(
    {
      frequency: input.frequency,
      interval: input.interval,
      startDate: input.startDate,
      endDate: input.endDate,
      enabled: input.enabled
    },
    todayKey()
  )
  return guess ?? input.endDate ?? input.startDate
}

export function create(input: RecurringInput): RecurringRule {
  const id = randomUUID()
  const ts = Date.now()
  getDb()
    .prepare(
      `INSERT INTO recurring
        (id, name, amount, type, category_id, account_id, to_account_id, frequency, interval,
         start_date, end_date, next_date, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name.trim(),
      input.amount,
      input.type,
      input.type === 'transfer' ? null : input.categoryId,
      input.accountId,
      input.type === 'transfer' ? input.toAccountId : null,
      input.frequency,
      input.interval,
      input.startDate,
      input.endDate,
      computeNextDate(input),
      input.enabled ? 1 : 0,
      ts,
      ts
    )
  return get(id) as RecurringRule
}

export function update(id: string, input: RecurringInput): RecurringRule {
  getDb()
    .prepare(
      `UPDATE recurring SET name = ?, amount = ?, type = ?, category_id = ?, account_id = ?, to_account_id = ?,
              frequency = ?, interval = ?, start_date = ?, end_date = ?, next_date = ?, enabled = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.name.trim(),
      input.amount,
      input.type,
      input.type === 'transfer' ? null : input.categoryId,
      input.accountId,
      input.type === 'transfer' ? input.toAccountId : null,
      input.frequency,
      input.interval,
      input.startDate,
      input.endDate,
      computeNextDate(input),
      input.enabled ? 1 : 0,
      Date.now(),
      id
    )
  return get(id) as RecurringRule
}

export function setEnabled(id: string, enabled: boolean): RecurringRule {
  getDb().prepare('UPDATE recurring SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, Date.now(), id)
  return get(id) as RecurringRule
}

export function remove(id: string): WriteResult {
  const changes = getDb().prepare('DELETE FROM recurring WHERE id = ?').run(id).changes
  return { ok: changes > 0, message: changes > 0 ? '规则已删除' : '规则不存在' }
}

export function countByAccount(): Map<string, number> {
  const rows = getDb()
    .prepare('SELECT account_id, COUNT(*) AS n FROM recurring WHERE account_id IS NOT NULL GROUP BY account_id')
    .all() as { account_id: string; n: number }[]
  return new Map(rows.map((row) => [row.account_id, row.n]))
}
