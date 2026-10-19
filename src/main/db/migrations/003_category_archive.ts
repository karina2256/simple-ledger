import type { Database } from 'better-sqlite3'

/**
 * 迁移 003：分类归档。
 *
 * 与账户同样的思路：有记录的分类不再「一律禁止删除」，而是归档 / 迁移并归档。
 * 这两列都能直接 ADD COLUMN，不需要重建表（分类的 UNIQUE 是 (parent_id, name, type)，
 * 顶层的 parent_id 为 NULL 时 SQLite 视为互不相等，重名本来就靠应用层拦截，
 * 所以把「归档后名字可复用」放在应用层做即可）。
 */
export const migration003 = {
  version: 3,
  name: 'category_archive',
  up(db: Database): void {
    db.exec(`
      ALTER TABLE categories ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE categories ADD COLUMN archived_at INTEGER;
      CREATE INDEX IF NOT EXISTS idx_categories_archived ON categories(is_archived);
    `)
  }
}
