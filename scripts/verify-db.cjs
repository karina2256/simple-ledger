/* 校验脚本：用 Electron 自带的 Node 运行，能加载与 Electron ABI 匹配的 better_sqlite3.node */
const path = require('node:path')
const Database = require('better-sqlite3')

const file = process.argv[2]
if (!file) {
  console.error('用法: electron verify.cjs <db 文件>')
  process.exit(2)
}

const db = new Database(file, { readonly: true })
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name)

console.log('user_version =', db.pragma('user_version', { simple: true }))
console.log('journal_mode =', db.pragma('journal_mode', { simple: true }))
console.log('tables       =', tables.join(', '))
console.log('accounts     =', db.prepare('SELECT COUNT(*) n FROM accounts').get().n)
console.log('categories   =', db.prepare('SELECT COUNT(*) n FROM categories').get().n)
console.log('settings     =', db.prepare('SELECT COUNT(*) n FROM settings').get().n)
console.log('records      =', db.prepare('SELECT COUNT(*) n FROM records').get().n)
console.log('quick_check  =', db.pragma('quick_check', { simple: true }))
console.log('db file      =', path.resolve(file))
db.close()
