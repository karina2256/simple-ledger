import { randomUUID } from 'node:crypto'
import { getDb } from '../connection'
import type { Budget, BudgetInput, BudgetPeriod, BudgetWithProgress, WriteResult } from '@shared/types'
import * as categoriesRepo from './categories.repo'
import * as statsRepo from './stats.repo'

/**
 * 预算：按「一级分类」或「全部」设一个月度/年度额度，进度实时算。
 *
 * 设计取舍：**不做「每月一条记录」**，而是「一条规则长期有效」+ 进度按当前周期现算。
 * 理由是记账用户最怕的就是「这个月忘了设预算」，规则化之后设一次就够了。
 */
interface Row {
  id: string
  category_id: string | null
  amount: number
  period: BudgetPeriod
  year: number | null
  month: number | null
  created_at: number
  updated_at: number
}

function map(row: Row): Budget {
  return {
    id: row.id,
    categoryId: row.category_id,
    amount: row.amount,
    period: row.period,
    year: row.year,
    month: row.month,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** 周期的起止日期（按自然月/自然年） */
export function periodRange(period: BudgetPeriod, anchor = new Date()): { from: string; to: string } {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const year = anchor.getFullYear()
  const month = anchor.getMonth() + 1
  if (period === 'yearly') {
    return { from: `${year}-01-01`, to: `${year}-12-31` }
  }
  const last = new Date(year, month, 0).getDate()
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` }
}

export function list(): BudgetWithProgress[] {
  const rows = getDb().prepare('SELECT * FROM budgets ORDER BY period, created_at').all() as Row[]
  const tree = categoriesRepo.tree(true)
  const byId = new Map<string, { name: string; parentName: string | null; type: 'income' | 'expense' }>()
  for (const parent of tree) {
    byId.set(parent.id, { name: parent.name, parentName: null, type: parent.type })
    for (const child of parent.children) {
      byId.set(child.id, { name: child.name, parentName: parent.name, type: parent.type })
    }
  }

  return rows.map((row) => {
    const budget = map(row)
    const range = periodRange(budget.period)
    const spent = statsRepo.subtreeTotal(budget.categoryId, range.from, range.to, 'expense')
    const meta = budget.categoryId ? byId.get(budget.categoryId) : null
    const ratio = budget.amount > 0 ? spent / budget.amount : 0
    return {
      ...budget,
      categoryName: meta?.name ?? null,
      categoryParentName: meta?.parentName ?? null,
      spent,
      remaining: budget.amount - spent,
      ratio,
      exceeded: spent > budget.amount,
      range
    }
  })
}

export function create(input: BudgetInput): Budget {
  const id = randomUUID()
  const ts = Date.now()
  getDb()
    .prepare(
      `INSERT INTO budgets (id, category_id, amount, period, year, month, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`
    )
    .run(id, input.categoryId, input.amount, input.period, ts, ts)
  return map(getDb().prepare('SELECT * FROM budgets WHERE id = ?').get(id) as Row)
}

export function update(id: string, input: BudgetInput): Budget {
  getDb()
    .prepare('UPDATE budgets SET category_id = ?, amount = ?, period = ?, updated_at = ? WHERE id = ?')
    .run(input.categoryId, input.amount, input.period, Date.now(), id)
  return map(getDb().prepare('SELECT * FROM budgets WHERE id = ?').get(id) as Row)
}

export function remove(id: string): WriteResult {
  const changes = getDb().prepare('DELETE FROM budgets WHERE id = ?').run(id).changes
  return { ok: changes > 0, message: changes > 0 ? undefined : '这条预算不存在' }
}

/** 同一分类 + 同一周期只允许一条，用来在保存前提示 */
export function exists(categoryId: string | null, period: BudgetPeriod, excludeId?: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM budgets
       WHERE period = ? AND ((category_id IS NULL AND ? IS NULL) OR category_id = ?)
         AND (? IS NULL OR id != ?)`
    )
    .get(period, categoryId, categoryId, excludeId ?? null, excludeId ?? null) as { id: string } | undefined
  return Boolean(row)
}
