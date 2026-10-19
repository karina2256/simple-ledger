import { randomUUID } from 'node:crypto'
import { getDb } from '../connection'
import { AMOUNT_BRACKETS } from '@shared/constants'
import type {
  CalendarDay,
  LedgerRecord,
  RecordInput,
  RecordListItem,
  RecordListResult,
  RecordQuery,
  RecordType } from '@shared/types'
import * as attachmentsRepo from './attachments.repo'
import * as categoriesRepo from './categories.repo'

interface Row {
  id: string
  date: string
  amount: number
  type: RecordType
  channel: string
  category_id: string | null
  account_id: string | null
  to_account_id: string | null
  note: string
  note_color: string | null
  tags: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

interface ListRow extends Row {
  category_name: string | null
  category_parent_name: string | null
  account_name: string | null
  to_account_name: string | null
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

function map(row: Row): LedgerRecord {
  return {
    id: row.id,
    date: row.date,
    amount: row.amount,
    type: row.type,
    channel: row.channel,
    categoryId: row.category_id,
    accountId: row.account_id,
    toAccountId: row.to_account_id,
    note: row.note,
    noteColor: row.note_color,
    tags: parseTags(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapListItem(row: ListRow): RecordListItem {
  return {
    ...map(row),
    categoryName: row.category_name,
    categoryParentName: row.category_parent_name,
    accountName: row.account_name,
    toAccountName: row.to_account_name,
    deletedAt: row.deleted_at,
    attachments: []
  }
}

/** 把 RecordQuery 翻译成 WHERE 子句（别名固定为 r，即 records 表） */
function buildWhere(query: RecordQuery): { sql: string; params: unknown[] } {
  const conds: string[] = []
  const params: unknown[] = []

  // 回收站只看已删除；否则默认只看未删除
  if (query.onlyDeleted) conds.push('r.deleted_at IS NOT NULL')
  else if (!query.includeDeleted) conds.push('r.deleted_at IS NULL')
  if (query.from) {
    conds.push('r.date >= ?')
    params.push(query.from)
  }
  if (query.to) {
    conds.push('r.date <= ?')
    params.push(query.to)
  }
  if (query.keyword && query.keyword.trim()) {
    const like = `%${query.keyword.trim()}%`
    conds.push('(r.note LIKE ? OR r.tags LIKE ?)')
    params.push(like, like)
  }
  if (query.categoryIds?.length) {
    // 选一级分类时把它的二级分类一起算进来
    const ids = categoriesRepo.selfAndDescendantIds(query.categoryIds)
    conds.push(`r.category_id IN (${ids.map(() => '?').join(',')})`)
    params.push(...ids)
  }
  if (query.accountIds?.length) {
    const marks = query.accountIds.map(() => '?').join(',')
    conds.push(`(r.account_id IN (${marks}) OR r.to_account_id IN (${marks}))`)
    params.push(...query.accountIds, ...query.accountIds)
  }
  if (query.types?.length) {
    conds.push(`r.type IN (${query.types.map(() => '?').join(',')})`)
    params.push(...query.types)
  }
  if (query.channels?.length) {
    conds.push(`r.channel IN (${query.channels.map(() => '?').join(',')})`)
    params.push(...query.channels)
  }
  if (query.amountBrackets?.length) {
    const groups: string[] = []
    for (const key of query.amountBrackets) {
      const bracket = AMOUNT_BRACKETS.find((b) => b.key === key)
      if (!bracket) continue
      if (bracket.max === null) {
        groups.push('r.amount >= ?')
        params.push(bracket.min * 100)
      } else {
        groups.push('(r.amount >= ? AND r.amount < ?)')
        params.push(bracket.min * 100, bracket.max * 100)
      }
    }
    if (groups.length) conds.push(`(${groups.join(' OR ')})`)
  }

  return { sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params }
}

export function list(query: RecordQuery): RecordListResult {
  const db = getDb()
  const where = buildWhere(query)

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN r.type = 'income'   THEN r.amount ELSE 0 END), 0) AS income_total,
              COALESCE(SUM(CASE WHEN r.type = 'expense'  THEN r.amount ELSE 0 END), 0) AS expense_total,
              COALESCE(SUM(CASE WHEN r.type = 'transfer' THEN r.amount ELSE 0 END), 0) AS transfer_total
       FROM records r ${where.sql}`
    )
    .get(...where.params) as {
    total: number
    income_total: number
    expense_total: number
    transfer_total: number
  }

  const limit = query.limit ?? 500
  const offset = query.offset ?? 0
  const rows = db
    .prepare(
      `SELECT r.*,
              c.name  AS category_name,
              pc.name AS category_parent_name,
              a.name  AS account_name,
              t.name  AS to_account_name
       FROM records r
       LEFT JOIN categories c  ON c.id = r.category_id
       LEFT JOIN categories pc ON pc.id = c.parent_id
       LEFT JOIN accounts   a  ON a.id = r.account_id
       LEFT JOIN accounts   t  ON t.id = r.to_account_id
       ${where.sql}
       ORDER BY r.date DESC, r.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...where.params, limit, offset) as ListRow[]

  const items = rows.map(mapListItem)
  const attachmentMap = attachmentsRepo.listByRecords(items.map((item) => item.id))
  for (const item of items) item.attachments = attachmentMap.get(item.id) ?? []

  return {
    items,
    total: totals.total,
    incomeTotal: totals.income_total,
    expenseTotal: totals.expense_total,
    transferTotal: totals.transfer_total
  }
}

export function getItem(id: string): RecordListItem | null {
  const row = getDb()
    .prepare(
      `SELECT r.*,
              c.name  AS category_name,
              pc.name AS category_parent_name,
              a.name  AS account_name,
              t.name  AS to_account_name
       FROM records r
       LEFT JOIN categories c  ON c.id = r.category_id
       LEFT JOIN categories pc ON pc.id = c.parent_id
       LEFT JOIN accounts   a  ON a.id = r.account_id
       LEFT JOIN accounts   t  ON t.id = r.to_account_id
       WHERE r.id = ?`
    )
    .get(id) as ListRow | undefined
  if (!row) return null
  const item = mapListItem(row)
  item.attachments = attachmentsRepo.listByRecord(id)
  return item
}

export function get(id: string): LedgerRecord | null {
  const row = getDb().prepare('SELECT * FROM records WHERE id = ?').get(id) as Row | undefined
  return row ? map(row) : null
}

export function create(input: RecordInput): LedgerRecord {
  const id = randomUUID()
  const ts = Date.now()
  getDb()
    .prepare(
      `INSERT INTO records
        (id, date, amount, type, channel, category_id, account_id, to_account_id, note, note_color, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.date,
      input.amount,
      input.type,
      input.channel,
      input.type === 'transfer' ? null : input.categoryId,
      input.accountId,
      input.type === 'transfer' ? input.toAccountId : null,
      input.note,
      input.noteColor,
      JSON.stringify(input.tags ?? []),
      ts,
      ts
    )
  return get(id) as LedgerRecord
}

export function update(id: string, input: RecordInput): LedgerRecord {
  getDb()
    .prepare(
      `UPDATE records SET date = ?, amount = ?, type = ?, channel = ?, category_id = ?, account_id = ?,
              to_account_id = ?, note = ?, note_color = ?, tags = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.date,
      input.amount,
      input.type,
      input.channel,
      input.type === 'transfer' ? null : input.categoryId,
      input.accountId,
      input.type === 'transfer' ? input.toAccountId : null,
      input.note,
      input.noteColor,
      JSON.stringify(input.tags ?? []),
      Date.now(),
      id
    )
  return get(id) as LedgerRecord
}

/** 软删除，配合「撤销删除」 */
export function softDelete(ids: string[]): number {
  if (ids.length === 0) return 0
  const marks = ids.map(() => '?').join(',')
  const ts = Date.now()
  const info = getDb()
    .prepare(`UPDATE records SET deleted_at = ?, updated_at = ? WHERE id IN (${marks}) AND deleted_at IS NULL`)
    .run(ts, ts, ...ids)
  return info.changes
}

export function restore(ids: string[]): number {
  if (ids.length === 0) return 0
  const marks = ids.map(() => '?').join(',')
  const info = getDb()
    .prepare(`UPDATE records SET deleted_at = NULL, updated_at = ? WHERE id IN (${marks})`)
    .run(Date.now(), ...ids)
  return info.changes
}

/** 彻底删除（含附件行，由外键级联处理） */
export function hardDelete(ids: string[]): number {
  if (ids.length === 0) return 0
  const marks = ids.map(() => '?').join(',')
  return getDb().prepare(`DELETE FROM records WHERE id IN (${marks})`).run(...ids).changes
}

/** 按月分组的小计，日历与汇总后面几轮会用到 */
export function monthTotals(year: number): { month: string; income: number; expense: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT substr(r.date, 1, 7) AS month,
              COALESCE(SUM(CASE WHEN r.type = 'income'  THEN r.amount ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN r.type = 'expense' THEN r.amount ELSE 0 END), 0) AS expense
       FROM records r
       WHERE r.deleted_at IS NULL AND r.date >= ? AND r.date <= ?
       GROUP BY month
       ORDER BY month`
    )
    .all(`${year}-01-01`, `${year}-12-31`) as { month: string; income: number; expense: number }[]
  return rows
}

/**
 * 按天聚合，日历四级视图的唯一数据来源。
 * 只返回有记录的天，缺的天由渲染层按需补 0。
 */
export function dayTotals(from: string, to: string): CalendarDay[] {
  return getDb()
    .prepare(
      `SELECT r.date AS date,
              COALESCE(SUM(CASE WHEN r.type = 'income'   THEN r.amount ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN r.type = 'expense'  THEN r.amount ELSE 0 END), 0) AS expense,
              COALESCE(SUM(CASE WHEN r.type = 'transfer' THEN r.amount ELSE 0 END), 0) AS transfer,
              COUNT(*) AS count
       FROM records r
       WHERE r.deleted_at IS NULL AND r.date >= ? AND r.date <= ?
       GROUP BY r.date
       ORDER BY r.date`
    )
    .all(from, to) as CalendarDay[]
}
