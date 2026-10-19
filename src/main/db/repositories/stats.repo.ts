import { getDb } from '../connection'
import type { CategoryTotal, StatsSummary } from '@shared/types'
import * as recordsRepo from './records.repo'
import * as categoriesRepo from './categories.repo'

/**
 * 统计汇总：图表页的唯一数据来源。
 *
 * 口径与全站一致：转账不计入收支；分类按一级分类聚合（子分类的金额并到父级）。
 */
export function summary(from: string, to: string): StatsSummary {
  const db = getDb()

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS income,
              COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense,
              COUNT(*) AS count,
              COALESCE(MAX(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS max_expense,
              COALESCE(MAX(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS max_income
       FROM records WHERE deleted_at IS NULL AND date >= ? AND date <= ?`
    )
    .get(from, to) as {
    income: number
    expense: number
    count: number
    max_expense: number
    max_income: number
  }

  // 按一级分类聚合：左连接到父级，NULL 时用自己
  const rows = db
    .prepare(
      `SELECT COALESCE(pc.id, c.id)            AS id,
              COALESCE(pc.name, c.name)        AS name,
              COALESCE(pc.icon, c.icon)        AS icon,
              COALESCE(pc.color, c.color)      AS color,
              r.type                           AS type,
              SUM(r.amount)                    AS total,
              COUNT(*)                         AS count
       FROM records r
       LEFT JOIN categories c  ON c.id = r.category_id
       LEFT JOIN categories pc ON pc.id = c.parent_id
       WHERE r.deleted_at IS NULL AND r.date >= ? AND r.date <= ?
         AND r.type IN ('income','expense')
       GROUP BY COALESCE(pc.id, c.id), r.type
       ORDER BY total DESC`
    )
    .all(from, to) as { id: string | null; name: string | null; icon: string | null; color: string | null; type: 'income' | 'expense'; total: number; count: number }[]

  const byCategory: CategoryTotal[] = rows.map((row) => ({
    categoryId: row.id,
    name: row.name ?? '未分类',
    icon: row.icon ?? 'inbox',
    color: row.color ?? '#8A9BA8',
    type: row.type,
    total: row.total,
    count: row.count
  }))

  return {
    range: { from, to },
    income: totals.income,
    expense: totals.expense,
    net: totals.income - totals.expense,
    count: totals.count,
    maxExpense: totals.max_expense,
    maxIncome: totals.max_income,
    monthly: recordsRepo.monthTotals(Number(from.slice(0, 4))),
    byCategory
  }
}

/** 分类下拉里「未分类」那一档的统计（图表需要，单独算一次） */
export function uncategorizedTotal(from: string, to: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS total FROM records
       WHERE deleted_at IS NULL AND category_id IS NULL AND type IN ('income','expense')
         AND date >= ? AND date <= ?`
    )
    .get(from, to) as { total: number }
  return row.total
}

/** 某分类（含子分类）在区间内的支出/收入合计，预算进度用它 */
export function subtreeTotal(categoryId: string | null, from: string, to: string, type: 'income' | 'expense'): number {
  const db = getDb()
  if (!categoryId) {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS total FROM records
         WHERE deleted_at IS NULL AND type = ? AND date >= ? AND date <= ?`
      )
      .get(type, from, to) as { total: number }
    return row.total
  }
  const ids = categoriesRepo.selfAndDescendantIds([categoryId])
  const marks = ids.map(() => '?').join(',')
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS total FROM records
       WHERE deleted_at IS NULL AND type = ? AND date >= ? AND date <= ? AND category_id IN (${marks})`
    )
    .get(type, from, to, ...ids) as { total: number }
  return row.total
}
