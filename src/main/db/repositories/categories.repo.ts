import { randomUUID } from 'node:crypto'
import { getDb } from '../connection'
import type {
  Category,
  CategoryInput,
  CategoryNode,
  CategoryType,
  CategoryUsage,
  MigrateResult,
  WriteResult
} from '@shared/types'

interface Row {
  id: string
  parent_id: string | null
  name: string
  icon: string
  color: string
  type: CategoryType
  sort_order: number
  is_archived: number
  archived_at: number | null
  created_at: number
  updated_at: number
}

function map(row: Row): Category {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    type: row.type,
    sortOrder: row.sort_order,
    isArchived: row.is_archived === 1,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function list(type?: CategoryType, includeArchived = false): Category[] {
  const conds = ['deleted_at IS NULL']
  const params: unknown[] = []
  if (!includeArchived) conds.push('is_archived = 0')
  if (type) {
    conds.push('type = ?')
    params.push(type)
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM categories WHERE ${conds.join(' AND ')} ORDER BY type DESC, sort_order, created_at`
    )
    .all(...params) as Row[]
  return rows.map(map)
}

/** 一级 + 二级树（默认不含归档） */
export function tree(includeArchived = false): CategoryNode[] {
  const all = list(undefined, includeArchived)
  const parents = all.filter((c) => c.parentId === null)
  return parents.map((parent) => ({
    ...parent,
    children: all
      .filter((c) => c.parentId === parent.id)
      .map((child) => ({ ...child, children: [] as CategoryNode[] }))
  }))
}

export function get(id: string): Category | null {
  const row = getDb().prepare('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL').get(id) as
    | Row
    | undefined
  return row ? map(row) : null
}

/** 某个一级分类及其所有二级分类的 id（用于「按一级分类筛选」时把子类一起带上） */
export function selfAndDescendantIds(ids: string[]): string[] {
  if (ids.length === 0) return []
  const marks = ids.map(() => '?').join(',')
  const rows = getDb()
    .prepare(`SELECT id FROM categories WHERE parent_id IN (${marks})`)
    .all(...ids) as { id: string }[]
  return [...new Set([...ids, ...rows.map((r) => r.id)])]
}

export function childIds(id: string): string[] {
  const rows = getDb()
    .prepare('SELECT id FROM categories WHERE parent_id = ? AND deleted_at IS NULL')
    .all(id) as { id: string }[]
  return rows.map((row) => row.id)
}

/** 未删除且未归档的分类里是否重名（归档后名字可以重新使用） */
export function nameExists(name: string, type: CategoryType, parentId: string | null, excludeId?: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM categories
       WHERE deleted_at IS NULL AND is_archived = 0 AND name = ? AND type = ?
         AND IFNULL(parent_id, '') = IFNULL(?, '') AND id <> ?`
    )
    .get(name, type, parentId, excludeId ?? '') as { id: string } | undefined
  return row !== undefined
}

export function create(input: CategoryInput): Category {
  const ts = Date.now()
  const id = randomUUID()
  const sortOrder =
    input.sortOrder ??
    (
      getDb()
        .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE type = ? AND IFNULL(parent_id, \'\') = IFNULL(?, \'\')')
        .get(input.type, input.parentId) as { n: number }
    ).n
  getDb()
    .prepare(
      `INSERT INTO categories (id, parent_id, name, icon, color, type, sort_order, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(id, input.parentId, input.name.trim(), input.icon, input.color, input.type, sortOrder, ts, ts)
  return get(id) as Category
}

export function update(id: string, input: CategoryInput): Category {
  getDb()
    .prepare(
      `UPDATE categories SET name = ?, icon = ?, color = ?, type = ?, parent_id = ?,
              sort_order = COALESCE(?, sort_order), updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .run(
      input.name.trim(),
      input.icon,
      input.color,
      input.type,
      input.parentId,
      input.sortOrder ?? null,
      Date.now(),
      id
    )
  return get(id) as Category
}

export function recordCount(ids: string[]): number {
  if (ids.length === 0) return 0
  const marks = ids.map(() => '?').join(',')
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM records WHERE category_id IN (${marks}) AND deleted_at IS NULL`)
    .get(...ids) as { n: number }
  return row.n
}

export function childCount(id: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ? AND deleted_at IS NULL')
    .get(id) as { n: number }
  return row.n
}

export function budgetCount(ids: string[]): number {
  if (ids.length === 0) return 0
  const marks = ids.map(() => '?').join(',')
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM budgets WHERE category_id IN (${marks})`)
    .get(...ids) as { n: number }
  return row.n
}

/** 删除前的现状：能不能真删、会影响什么（记录数含子分类） */
export function usage(id: string): CategoryUsage {
  const ids = selfAndDescendantIds([id])
  const records = recordCount(ids)
  const children = childCount(id)
  return {
    categoryId: id,
    recordCount: records,
    childCount: children,
    canHardDelete: records === 0 && children === 0
  }
}

/** 归档：一级分类归档时，其子分类一并归档 */
export function archive(id: string): MigrateResult {
  const target = get(id)
  if (!target) return { ok: false, message: '分类不存在' }
  if (target.isArchived) return { ok: true, message: '分类已经是归档状态', archivedChildren: 0 }
  const ids = selfAndDescendantIds([id])
  const marks = ids.map(() => '?').join(',')
  const ts = Date.now()
  getDb()
    .prepare(`UPDATE categories SET is_archived = 1, archived_at = ?, updated_at = ? WHERE id IN (${marks})`)
    .run(ts, ts, ...ids)
  return { ok: true, message: '分类已归档', archivedChildren: ids.length - 1 }
}

/** 恢复：子分类一起回来；上级仍处于归档状态时先恢复上级 */
export function restore(id: string): WriteResult {
  const target = get(id)
  if (!target) return { ok: false, message: '分类不存在' }
  if (!target.isArchived) return { ok: true, message: '分类本来就在使用中' }
  if (target.parentId) {
    const parent = get(target.parentId)
    if (parent?.isArchived) return { ok: false, message: `上级分类「${parent.name}」还在归档状态，请先恢复它` }
  }
  if (nameExists(target.name, target.type, target.parentId, target.id)) {
    return { ok: false, message: `同级下已有同名分类「${target.name}」，请先改名再恢复` }
  }
  const ids = selfAndDescendantIds([id])
  const marks = ids.map(() => '?').join(',')
  getDb()
    .prepare(`UPDATE categories SET is_archived = 0, archived_at = NULL, updated_at = ? WHERE id IN (${marks})`)
    .run(Date.now(), ...ids)
  return { ok: true, message: '分类已恢复' }
}

/** 只有没有任何记录、也没有子分类时才允许真删除 */
export function remove(id: string): WriteResult {
  const target = get(id)
  if (!target) return { ok: false, message: '分类不存在' }
  const info = usage(id)
  if (!info.canHardDelete) {
    return {
      ok: false,
      code: 'NEEDS_DECISION',
      message: `该分类（含子分类）下有 ${info.recordCount} 笔记录、${info.childCount} 个子分类，不能直接删除`
    }
  }
  getDb().prepare('DELETE FROM categories WHERE id = ?').run(id)
  return { ok: true, message: '分类已删除' }
}

/**
 * 迁移并归档：把该分类（含子分类）下的记录改挂到目标分类，然后归档整棵子树。
 * 预算一并迁移；目标上已有同周期预算时保留目标那条，源的那条删除。
 */
export function migrateAndArchive(sourceId: string, targetId: string): MigrateResult {
  const db = getDb()
  const source = get(sourceId)
  const target = get(targetId)
  if (!source) return { ok: false, message: '源分类不存在' }
  if (!target) return { ok: false, message: '目标分类不存在' }
  if (sourceId === targetId) return { ok: false, message: '目标分类不能是它自己' }
  if (target.isArchived) return { ok: false, message: '目标分类处于归档状态，请先恢复它' }
  if (source.type !== target.type) return { ok: false, message: '只能在同类型（收入 / 支出）的分类之间迁移' }

  const sourceIds = selfAndDescendantIds([sourceId])
  const marks = sourceIds.map(() => '?').join(',')

  const run = db.transaction((): MigrateResult => {
    const ts = Date.now()
    const movedRecords = db
      .prepare(`UPDATE records SET category_id = ?, updated_at = ? WHERE category_id IN (${marks})`)
      .run(targetId, ts, ...sourceIds).changes

    // 目标上已有同周期预算 → 保留目标的，删掉源的，避免出现两条一样的预算
    db.prepare(
      `DELETE FROM budgets WHERE category_id IN (${marks}) AND EXISTS (
         SELECT 1 FROM budgets b2
         WHERE b2.category_id = ? AND b2.period = budgets.period
           AND IFNULL(b2.year, -1) = IFNULL(budgets.year, -1)
           AND IFNULL(b2.month, -1) = IFNULL(budgets.month, -1)
       )`
    ).run(...sourceIds, targetId)
    const movedBudgets = db
      .prepare(`UPDATE budgets SET category_id = ?, updated_at = ? WHERE category_id IN (${marks})`)
      .run(targetId, ts, ...sourceIds).changes

    db.prepare(
      `UPDATE categories SET is_archived = 1, archived_at = ?, updated_at = ? WHERE id IN (${marks})`
    ).run(ts, ts, ...sourceIds)

    return {
      ok: true,
      message: `已迁移到「${target.name}」并归档「${source.name}」`,
      movedRecords,
      archivedChildren: sourceIds.length - 1,
      movedRecurring: movedBudgets
    }
  })

  return run()
}
