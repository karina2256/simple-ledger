import { randomUUID } from 'node:crypto'
import { getDb } from '../connection'
import type {
  Account,
  AccountInput,
  AccountUsage,
  AccountWithBalance,
  MigrateResult,
  WriteResult
} from '@shared/types'

interface Row {
  id: string
  name: string
  icon: string
  color: string
  initial_balance: number
  sort_order: number
  is_archived: number
  archived_at: number | null
  created_at: number
  updated_at: number
}

function map(row: Row): Account {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    initialBalance: row.initial_balance,
    sortOrder: row.sort_order,
    isArchived: row.is_archived === 1,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const BASE = `SELECT * FROM accounts WHERE deleted_at IS NULL`

function archivedFilter(includeArchived: boolean): string {
  return includeArchived ? '' : ' AND is_archived = 0'
}

export function list(includeArchived = false): Account[] {
  const rows = getDb()
    .prepare(`${BASE}${archivedFilter(includeArchived)} ORDER BY is_archived, sort_order, created_at`)
    .all() as Row[]
  return rows.map(map)
}

/**
 * 余额口径：初始余额 + 收入 − 支出 + 转入 − 转出（都不含已删除记录）。
 * 归档账户默认不算进来；要显示历史时用 includeArchived = true。
 */
export function listWithBalance(includeArchived = false): AccountWithBalance[] {
  const sql = `
    SELECT a.*,
      COALESCE(io.income, 0)       AS income,
      COALESCE(io.expense, 0)      AS expense,
      COALESCE(tin.total, 0)       AS transfer_in,
      COALESCE(tout.total, 0)      AS transfer_out
    FROM accounts a
    LEFT JOIN (
      SELECT account_id,
             SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END) AS income,
             SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
      FROM records WHERE deleted_at IS NULL GROUP BY account_id
    ) io ON io.account_id = a.id
    LEFT JOIN (
      SELECT to_account_id AS account_id, SUM(amount) AS total
      FROM records WHERE deleted_at IS NULL AND type = 'transfer' AND to_account_id IS NOT NULL
      GROUP BY to_account_id
    ) tin ON tin.account_id = a.id
    LEFT JOIN (
      SELECT account_id, SUM(amount) AS total
      FROM records WHERE deleted_at IS NULL AND type = 'transfer'
      GROUP BY account_id
    ) tout ON tout.account_id = a.id
    WHERE a.deleted_at IS NULL${archivedFilter(includeArchived)}
    ORDER BY a.is_archived, a.sort_order, a.created_at
  `
  const rows = getDb().prepare(sql).all() as (Row & {
    income: number
    expense: number
    transfer_in: number
    transfer_out: number
  })[]
  return rows.map((row) => ({
    ...map(row),
    income: row.income,
    expense: row.expense,
    transferIn: row.transfer_in,
    transferOut: row.transfer_out,
    balance: row.initial_balance + row.income - row.expense + row.transfer_in - row.transfer_out
  }))
}

export function get(id: string): Account | null {
  const row = getDb().prepare(`${BASE} AND id = ?`).get(id) as Row | undefined
  return row ? map(row) : null
}

/** 未删除的账户里（含已归档）是否重名 —— 与部分唯一索引 idx_accounts_name_live 保持一致 */
export function nameExists(name: string, excludeId?: string): boolean {
  const row = getDb()
    .prepare(`SELECT id FROM accounts WHERE deleted_at IS NULL AND name = ? AND id <> ?`)
    .get(name, excludeId ?? '') as { id: string } | undefined
  return row !== undefined
}

export function create(input: AccountInput): Account {
  const ts = Date.now()
  const id = randomUUID()
  const sortOrder =
    input.sortOrder ??
    (getDb().prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM accounts').get() as { n: number }).n
  getDb()
    .prepare(
      `INSERT INTO accounts (id, name, icon, color, initial_balance, sort_order, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(id, input.name.trim(), input.icon, input.color, input.initialBalance, sortOrder, ts, ts)
  return get(id) as Account
}

export function update(id: string, input: AccountInput): Account {
  getDb()
    .prepare(
      `UPDATE accounts SET name = ?, icon = ?, color = ?, initial_balance = ?, sort_order = COALESCE(?, sort_order), updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .run(
      input.name.trim(),
      input.icon,
      input.color,
      input.initialBalance,
      input.sortOrder ?? null,
      Date.now(),
      id
    )
  return get(id) as Account
}

function balanceOf(id: string): number {
  const row = getDb()
    .prepare(
      `SELECT
         (SELECT initial_balance FROM accounts WHERE id = @id) +
         COALESCE((SELECT SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END) FROM records
                   WHERE deleted_at IS NULL AND account_id = @id), 0) -
         COALESCE((SELECT SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) FROM records
                   WHERE deleted_at IS NULL AND account_id = @id), 0) +
         COALESCE((SELECT SUM(amount) FROM records
                   WHERE deleted_at IS NULL AND type = 'transfer' AND to_account_id = @id), 0) -
         COALESCE((SELECT SUM(amount) FROM records
                   WHERE deleted_at IS NULL AND type = 'transfer' AND account_id = @id), 0) AS balance`
    )
    .get({ id }) as { balance: number }
  return row.balance
}

function countRecords(id: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM records WHERE deleted_at IS NULL AND (account_id = ? OR to_account_id = ?)`)
    .get(id, id) as { n: number }
  return row.n
}

function countRecurring(id: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM recurring WHERE account_id = ? OR to_account_id = ?`)
    .get(id, id) as { n: number }
  return row.n
}

/** 删除前的现状：能不能真删、删了会影响什么 */
export function usage(id: string): AccountUsage {
  const recordCount = countRecords(id)
  const recurringCount = countRecurring(id)
  return {
    accountId: id,
    recordCount,
    recurringCount,
    // budgets 只有分类维度，没有账户字段，所以这里恒为 0；见 docs 说明
    budgetCount: 0,
    balance: balanceOf(id),
    canHardDelete: recordCount === 0 && recurringCount === 0
  }
}

export function archive(id: string): WriteResult {
  const account = get(id)
  if (!account) return { ok: false, message: '账户不存在' }
  if (account.isArchived) return { ok: true, message: '账户已经是归档状态' }
  const ts = Date.now()
  getDb()
    .prepare('UPDATE accounts SET is_archived = 1, archived_at = ?, updated_at = ? WHERE id = ?')
    .run(ts, ts, id)
  return { ok: true, message: '账户已归档' }
}

export function restore(id: string): WriteResult {
  const account = get(id)
  if (!account) return { ok: false, message: '账户不存在' }
  if (!account.isArchived) return { ok: true, message: '账户本来就在使用中' }
  if (nameExists(account.name, id)) {
    return { ok: false, message: `已有同名账户「${account.name}」，请先改名再恢复` }
  }
  getDb()
    .prepare('UPDATE accounts SET is_archived = 0, archived_at = NULL, updated_at = ? WHERE id = ?')
    .run(Date.now(), id)
  return { ok: true, message: '账户已恢复' }
}

/** 只有余额为 0、且没有任何记录 / 周期规则时才允许真删除 */
export function remove(id: string): WriteResult {
  const account = get(id)
  if (!account) return { ok: false, message: '账户不存在' }
  const info = usage(id)
  if (!info.canHardDelete) {
    return {
      ok: false,
      code: 'NEEDS_DECISION',
      message: `该账户还有 ${info.recordCount} 笔记录、${info.recurringCount} 条周期规则，不能直接删除`
    }
  }
  if (info.balance !== 0) {
    return {
      ok: false,
      code: 'NEEDS_DECISION',
      message: `该账户余额为 ${(info.balance / 100).toFixed(2)}，不能直接删除`
    }
  }
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
  return { ok: true, message: '账户已删除' }
}

/**
 * 迁移并归档：把源账户名下的记录、周期规则全部转到目标账户，源账户随后归档。
 *
 * 关键取舍：
 *  - 源账户的初始余额并入目标账户的初始余额，否则合并后总额会少一截。
 *  - 原本在「源 ⇄ 目标」之间的转账，合并后会变成自己转自己，这类记录软删除
 *    （留在库里可恢复，但不参与余额计算），否则目标账户会被凭空扣掉一笔。
 *  - 整个过程一个事务，任一步失败全部回滚。
 */
export function migrateAndArchive(sourceId: string, targetId: string): MigrateResult {
  const db = getDb()
  const source = get(sourceId)
  const target = get(targetId)
  if (!source) return { ok: false, message: '源账户不存在' }
  if (!target) return { ok: false, message: '目标账户不存在' }
  if (sourceId === targetId) return { ok: false, message: '目标账户不能是它自己' }
  if (target.isArchived) return { ok: false, message: '目标账户处于归档状态，请先恢复它' }

  const run = db.transaction((): MigrateResult => {
    const ts = Date.now()

    // 先记下与源账户有关的转账，迁移后判断哪些变成了自己转自己
    const transfers = (
      db
        .prepare(`SELECT id FROM records WHERE type = 'transfer' AND (account_id = ? OR to_account_id = ?)`)
        .all(sourceId, sourceId) as { id: string }[]
    ).map((row) => row.id)

    db.prepare('UPDATE accounts SET initial_balance = initial_balance + ?, updated_at = ? WHERE id = ?').run(
      source.initialBalance,
      ts,
      targetId
    )
    const movedRecords = db
      .prepare('UPDATE records SET account_id = ?, updated_at = ? WHERE account_id = ?')
      .run(targetId, ts, sourceId).changes
    const movedIncoming = db
      .prepare('UPDATE records SET to_account_id = ?, updated_at = ? WHERE to_account_id = ?')
      .run(targetId, ts, sourceId).changes
    const movedRecurring = db
      .prepare('UPDATE recurring SET account_id = ?, updated_at = ? WHERE account_id = ?')
      .run(targetId, ts, sourceId).changes
    db.prepare('UPDATE recurring SET to_account_id = ?, updated_at = ? WHERE to_account_id = ?').run(
      targetId,
      ts,
      sourceId
    )

    // 合并后自己转自己的记录：软删除，余额不受影响，数据仍可恢复
    let mergedTransfers = 0
    if (transfers.length > 0) {
      const marks = transfers.map(() => '?').join(',')
      mergedTransfers = db
        .prepare(
          `UPDATE records SET deleted_at = ?, updated_at = ?
           WHERE id IN (${marks}) AND type = 'transfer'
             AND account_id = ? AND to_account_id = ? AND deleted_at IS NULL`
        )
        .run(ts, ts, ...transfers, targetId, targetId).changes
    }

    // 周期规则同理：变成自己转自己的先停用
    const disabledRecurring = db
      .prepare(
        `UPDATE recurring SET enabled = 0, updated_at = ?
         WHERE type = 'transfer' AND account_id = ? AND to_account_id = ? AND enabled = 1`
      )
      .run(ts, targetId, targetId).changes

    db.prepare('UPDATE accounts SET is_archived = 1, archived_at = ?, updated_at = ? WHERE id = ?').run(
      ts,
      ts,
      sourceId
    )

    return {
      ok: true,
      message: `已迁移到「${target.name}」并归档「${source.name}」`,
      movedRecords: movedRecords + movedIncoming,
      movedRecurring,
      mergedTransfers,
      disabledRecurring
    }
  })

  return run()
}
