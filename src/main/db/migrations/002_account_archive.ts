import type { Database } from 'better-sqlite3'

/**
 * 迁移 002：账户归档 / 迁移。
 *
 * 1. accounts 重建：加 is_archived、archived_at；name 的全局 UNIQUE 换成
 *    「未删除的行才唯一」的部分索引，顺带修掉一个老问题——软删除过的账户名会永久占位。
 * 2. recurring 补 to_account_id：001 里 recurring.type 允许 transfer，却没有转入账户字段，
 *    归档迁移时无法判断转账双方。补一个可空列，不影响已有数据。
 *
 * 重建表必须在 foreign_keys=OFF 下做，由迁移执行器负责开关。
 */
export const migration002 = {
  version: 2,
  name: 'account_archive',
  foreignKeysOff: true,
  up(db: Database): void {
    db.exec(`
      CREATE TABLE accounts_new (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        icon            TEXT NOT NULL DEFAULT 'wallet',
        color           TEXT NOT NULL DEFAULT '#64748B',
        initial_balance INTEGER NOT NULL DEFAULT 0,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        is_archived     INTEGER NOT NULL DEFAULT 0,
        archived_at     INTEGER,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        deleted_at      INTEGER
      );

      INSERT INTO accounts_new
        (id, name, icon, color, initial_balance, sort_order, is_archived, archived_at, created_at, updated_at, deleted_at)
      SELECT
        id, name, icon, color, initial_balance, sort_order, 0, NULL, created_at, updated_at, deleted_at
      FROM accounts;

      DROP TABLE accounts;
      ALTER TABLE accounts_new RENAME TO accounts;

      CREATE UNIQUE INDEX idx_accounts_name_live ON accounts(name) WHERE deleted_at IS NULL;
      CREATE INDEX idx_accounts_archived ON accounts(is_archived);
    `)

    db.exec(`
      ALTER TABLE recurring ADD COLUMN to_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;
    `)
  }
}
