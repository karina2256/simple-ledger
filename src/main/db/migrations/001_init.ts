import type { Database } from 'better-sqlite3'

/**
 * 迁移 001：建表 + 索引。
 * 约定：
 *  - 金额一律 INTEGER（分）
 *  - 时间戳 INTEGER（Unix 毫秒），业务日期 TEXT（YYYY-MM-DD）
 *  - 软删除 deleted_at INTEGER NULL
 */
export const migration001 = {
  version: 1,
  name: 'init',
  up(db: Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL UNIQUE,
        icon            TEXT NOT NULL DEFAULT 'wallet',
        color           TEXT NOT NULL DEFAULT '#64748B',
        initial_balance INTEGER NOT NULL DEFAULT 0,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        deleted_at      INTEGER
      );

      CREATE TABLE IF NOT EXISTS categories (
        id         TEXT PRIMARY KEY,
        parent_id  TEXT REFERENCES categories(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        icon       TEXT NOT NULL DEFAULT 'tag',
        color      TEXT NOT NULL DEFAULT '#64748B',
        type       TEXT NOT NULL CHECK (type IN ('income','expense')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        UNIQUE (parent_id, name, type)
      );
      CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

      CREATE TABLE IF NOT EXISTS records (
        id            TEXT PRIMARY KEY,
        date          TEXT NOT NULL,
        amount        INTEGER NOT NULL CHECK (amount >= 0),
        type          TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
        channel       TEXT NOT NULL DEFAULT 'offline',
        category_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
        account_id    TEXT REFERENCES accounts(id)   ON DELETE SET NULL,
        to_account_id TEXT REFERENCES accounts(id)   ON DELETE SET NULL,
        note          TEXT NOT NULL DEFAULT '',
        note_color    TEXT,
        tags          TEXT NOT NULL DEFAULT '[]',
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        deleted_at    INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_records_date      ON records(date);
      CREATE INDEX IF NOT EXISTS idx_records_account   ON records(account_id);
      CREATE INDEX IF NOT EXISTS idx_records_category  ON records(category_id);
      CREATE INDEX IF NOT EXISTS idx_records_type_date ON records(type, date);
      CREATE INDEX IF NOT EXISTS idx_records_note      ON records(note);

      CREATE TABLE IF NOT EXISTS attachments (
        id         TEXT PRIMARY KEY,
        record_id  TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
        file_path  TEXT NOT NULL,
        file_name  TEXT NOT NULL,
        file_type  TEXT NOT NULL,
        file_size  INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_record ON attachments(record_id);

      CREATE TABLE IF NOT EXISTS recurring (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        amount      INTEGER NOT NULL,
        type        TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        account_id  TEXT REFERENCES accounts(id)   ON DELETE SET NULL,
        frequency   TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
        interval    INTEGER NOT NULL DEFAULT 1,
        start_date  TEXT NOT NULL,
        end_date    TEXT,
        next_date   TEXT NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_recurring_next ON recurring(enabled, next_date);

      CREATE TABLE IF NOT EXISTS budgets (
        id          TEXT PRIMARY KEY,
        category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
        amount      INTEGER NOT NULL,
        period      TEXT NOT NULL CHECK (period IN ('monthly','yearly')),
        year        INTEGER,
        month       INTEGER,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  }
}
