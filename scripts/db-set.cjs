/**
 * 小工具：直接改一条 settings（用于截图脚本切换主题等）。
 * 必须用 Electron 自带的 Node 运行：
 *   electron.exe scripts/db-set.cjs <db 文件> <key> <JSON 值>
 */
const Database = require('better-sqlite3')

const [file, key, rawValue] = process.argv.slice(2)
if (!file || !key || rawValue === undefined) {
  console.error('用法: db-set.cjs <db 文件> <key> <JSON 值>')
  process.exit(2)
}

const db = new Database(file)
db.prepare(
  `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
).run(key, rawValue, Date.now())
console.log(`[db-set] ${key} = ${rawValue}`)
db.close()
