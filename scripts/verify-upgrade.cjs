/**
 * 升级路径验证：造一个第一轮格式（user_version = 1）的老数据库，
 * 让应用跑一次真实迁移，再检查数据是否完好、schema 是否升到 v2。
 *
 * 必须用 Electron 自带的 Node 运行（better-sqlite3 是按 Electron ABI 编译的）：
 *   npm run verify:upgrade
 */
const { spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const root = path.resolve(__dirname, '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const sandbox = path.join(root, '.tmp', 'upgrade')
const userData = path.join(sandbox, 'userdata')
const dataDir = path.join(sandbox, 'data')
const dbFile = path.join(dataDir, 'daily-ledger.db')

const results = []
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: String(detail) })

// ---------- 1. 造一个 v1 老库 ----------
rmSync(sandbox, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(userData, { recursive: true })

const db = new Database(dbFile)
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE accounts (
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
  CREATE TABLE categories (
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
  CREATE TABLE records (
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
  CREATE TABLE attachments (
    id         TEXT PRIMARY KEY,
    record_id  TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    file_path  TEXT NOT NULL,
    file_name  TEXT NOT NULL,
    file_type  TEXT NOT NULL,
    file_size  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE recurring (
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
  CREATE TABLE budgets (
    id          TEXT PRIMARY KEY,
    category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
    amount      INTEGER NOT NULL,
    period      TEXT NOT NULL CHECK (period IN ('monthly','yearly')),
    year        INTEGER,
    month       INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

const ts = Date.now()
db.prepare(
  `INSERT INTO accounts (id, name, icon, color, initial_balance, sort_order, created_at, updated_at)
   VALUES ('acc-old-1','老账户甲','💬','#4FB3A5',12345,0,?,?)`
).run(ts, ts)
db.prepare(
  `INSERT INTO accounts (id, name, icon, color, initial_balance, sort_order, created_at, updated_at)
   VALUES ('acc-old-2','老账户乙','🅰️','#4A9BD1',0,1,?,?)`
).run(ts, ts)
db.prepare(
  `INSERT INTO categories (id, parent_id, name, icon, color, type, sort_order, created_at, updated_at)
   VALUES ('cat-old-1',NULL,'老分类','🍜','#E8836B','expense',0,?,?)`
).run(ts, ts)
db.prepare(
  `INSERT INTO records (id, date, amount, type, channel, category_id, account_id, to_account_id, note, note_color, tags, created_at, updated_at)
   VALUES ('rec-old-1','2025-05-05',2888,'expense','dining','cat-old-1','acc-old-1',NULL,'老记录',NULL,'["旧"]',?,?)`
).run(ts, ts)
db.prepare(
  `INSERT INTO records (id, date, amount, type, channel, category_id, account_id, to_account_id, note, note_color, tags, created_at, updated_at)
   VALUES ('rec-old-2','2025-05-06',1000,'transfer','transfer',NULL,'acc-old-1','acc-old-2','老转账',NULL,'[]',?,?)`
).run(ts, ts)
db.prepare(
  `INSERT INTO recurring (id, name, amount, type, category_id, account_id, frequency, interval, start_date, end_date, next_date, enabled, created_at, updated_at)
   VALUES ('rec-rule-1','老房租',200000,'expense','cat-old-1','acc-old-1','monthly',1,'2025-01-01',NULL,'2025-06-01',1,?,?)`
).run(ts, ts)
db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('currency','"CNY"',?)`).run(ts)
// 真实的 v1 库一定带着这个标记（首次启动写过预设），带上它才能验证「迁移不会重复写预设」
db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('seeded','1',?)`).run(ts)
db.pragma('user_version = 1')
db.close()

check('已生成 v1 老库', existsSync(dbFile), dbFile)

writeFileSync(
  path.join(userData, 'config.json'),
  JSON.stringify({ initialized: true, dataDir }, null, 2),
  'utf-8'
)

// ---------- 2. 让应用跑一次真实迁移 ----------
// 注意：本脚本自己是 ELECTRON_RUN_AS_NODE 启动的，必须把这个变量摘掉，
// 否则子进程里的 Electron 会退化成纯 Node，拿不到 protocol 等模块。
const childEnv = { ...process.env, LEDGER_MIGRATE_ONLY: '1' }
delete childEnv.ELECTRON_RUN_AS_NODE
const migrate = spawnSync(electronExe, [path.join(root, 'out', 'main', 'index.js'), `--user-data-dir=${userData}`], {
  stdio: 'inherit',
  env: childEnv
})
check('迁移进程正常退出', migrate.status === 0, `exit ${migrate.status}`)

// ---------- 3. 检查升级结果 ----------
const after = new Database(dbFile, { readonly: true })
const version = after.pragma('user_version', { simple: true })
check('user_version 升到 3', version === 3, version)

const accountColumns = after.pragma('table_info(accounts)').map((row) => row.name)
check('accounts 有 is_archived', accountColumns.includes('is_archived'), accountColumns.join(','))
check('accounts 有 archived_at', accountColumns.includes('archived_at'), 'ok')

const categoryColumns = after.pragma('table_info(categories)').map((row) => row.name)
check('categories 有 is_archived', categoryColumns.includes('is_archived'), 'ok')
check('categories 有 archived_at', categoryColumns.includes('archived_at'), 'ok')

const recurringColumns = after.pragma('table_info(recurring)').map((row) => row.name)
check('recurring 有 to_account_id', recurringColumns.includes('to_account_id'), 'ok')

const oldCategories = after.prepare('SELECT * FROM categories').all()
check(
  '分类数据保留且默认未归档',
  oldCategories.length === 1 && oldCategories[0].name === '老分类' && oldCategories[0].is_archived === 0,
  `${oldCategories.length} 个`
)

const accounts = after.prepare('SELECT * FROM accounts ORDER BY id').all()
check('账户数据保留且未重复写预设', accounts.length === 2, `${accounts.length} 个`)
check('初始余额保留', accounts.find((row) => row.id === 'acc-old-1').initial_balance === 12345, 'acc-old-1')
check('归档字段默认值正确', accounts.every((row) => row.is_archived === 0 && row.archived_at === null), 'ok')

const records = after.prepare('SELECT * FROM records ORDER BY id').all()
check('记录数据保留', records.length === 2, `${records.length} 笔`)
check('记录的账户引用未变', records[0].account_id === 'acc-old-1', records[0].account_id)
check('备注与标签保留', records[0].note === '老记录' && records[0].tags === '["旧"]', records[0].note)

const recurring = after.prepare('SELECT * FROM recurring').all()
check('周期规则保留', recurring.length === 1 && recurring[0].next_date === '2025-06-01', recurring.length)

const indexes = after
  .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='accounts'")
  .all()
  .map((row) => row.name)
check('部分唯一索引已建立', indexes.includes('idx_accounts_name_live'), indexes.join(','))
check(
  '没有遗留的 accounts_new 表',
  after.prepare("SELECT name FROM sqlite_master WHERE name='accounts_new'").get() === undefined,
  'ok'
)
check('外键校验通过', after.pragma('foreign_key_check').length === 0, 'ok')
check('完整性校验通过', after.pragma('quick_check', { simple: true }) === 'ok', 'ok')

// v1 里被软删除的账户名会永久占位；v2 换成部分索引后应该能重新用
const insert = after.prepare('SELECT 1').get()
void insert
after.close()

const writable = new Database(dbFile)
writable.prepare('UPDATE accounts SET deleted_at = ? WHERE id = ?').run(Date.now(), 'acc-old-2')
let reuseOk = true
try {
  writable
    .prepare(
      `INSERT INTO accounts (id, name, icon, color, initial_balance, sort_order, is_archived, created_at, updated_at)
       VALUES ('acc-new','老账户乙','💳','#8A9BA8',0,2,0,?,?)`
    )
    .run(Date.now(), Date.now())
} catch (error) {
  reuseOk = false
  void error
}
check('软删除后名字可以重新使用', reuseOk, 'ok')
writable.close()

const failed = results.filter((item) => !item.ok)
console.log('\n===== 升级路径验证（v1 → 最新版本）=====')
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  ${item.detail}`)
console.log(`===== ${results.length - failed.length}/${results.length} 通过 =====\n`)
process.exit(failed.length === 0 ? 0 : 1)
