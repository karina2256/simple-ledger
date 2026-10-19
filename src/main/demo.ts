import { addDays, addMonths, todayKey } from '@shared/date'
import * as accountsRepo from './db/repositories/accounts.repo'
import * as categoriesRepo from './db/repositories/categories.repo'
import * as recordsRepo from './db/repositories/records.repo'
import * as recurringRepo from './db/repositories/recurring.repo'
import { getDb } from './db/connection'

/**
 * 示例数据（可选）。
 *
 * 用固定种子的伪随机数生成，同一台机器上反复执行结果一致，便于对照。
 * 只在 settings 里没有 demoSeeded 标记时写入一次，不会重复灌数据。
 */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NOTES = [
  '公司楼下的麻辣烫',
  '地铁通勤',
  '楼下便利店',
  '奶茶外卖',
  '周末聚餐',
  '打车回家',
  '超市采购',
  '咖啡续命',
  '电影票',
  '话费充值',
  '水果店',
  '药品'
]

export interface DemoSeedResult {
  seeded: boolean
  records: number
  rules: number
}

export function seedDemoData(): DemoSeedResult {
  const db = getDb()
  const done = db.prepare(`SELECT value FROM settings WHERE key = 'demoSeeded'`).get() as
    | { value: string }
    | undefined
  if (done) return { seeded: false, records: 0, rules: 0 }

  const accounts = accountsRepo.list()
  const tree = categoriesRepo.tree()
  if (accounts.length === 0 || tree.length === 0) return { seeded: false, records: 0, rules: 0 }

  const expenseParents = tree.filter((node) => node.type === 'expense')
  const incomeParent = tree.find((node) => node.type === 'income')
  const pick = <T>(list: T[], random: () => number): T => list[Math.floor(random() * list.length)]

  const random = mulberry32(20250618)
  const today = todayKey()
  const startMonth = addMonths(today, -11).slice(0, 7)
  let count = 0

  const run = db.transaction(() => {
    for (let offset = 0; offset < 12; offset += 1) {
      const monthStart = addMonths(`${startMonth}-01`, offset)
      const month = monthStart.slice(0, 7)
      const isCurrentMonth = month === today.slice(0, 7)
      const dayLimit = isCurrentMonth ? Number(today.slice(8, 10)) : 28

      // 房租：每月 1 号
      if (dayLimit >= 1) {
        recordsRepo.create({
          date: `${month}-01`,
          amount: 250000,
          type: 'expense',
          channel: 'offline',
          categoryId: expenseParents.find((node) => node.name === '居住')?.children[0]?.id ?? expenseParents[0].id,
          accountId: pick(accounts, random).id,
          toAccountId: null,
          note: '房租',
          noteColor: null,
          tags: ['固定支出']
        })
        count += 1
      }

      // 工资：每月 10 号
      if (dayLimit >= 10) {
        recordsRepo.create({
          date: `${month}-10`,
          amount: 1180000 + Math.floor(random() * 20) * 5000,
          type: 'income',
          channel: 'other',
          categoryId: incomeParent?.children[0]?.id ?? incomeParent?.id ?? null,
          accountId: accounts[0].id,
          toAccountId: null,
          note: '工资',
          noteColor: null,
          tags: ['收入']
        })
        count += 1
      }

      // 日常支出
      const daily = 9 + Math.floor(random() * 7)
      for (let index = 0; index < daily; index += 1) {
        const day = 2 + Math.floor(random() * Math.max(1, dayLimit - 2))
        const date = `${month}-${String(Math.min(day, dayLimit)).padStart(2, '0')}`
        if (date > today) continue
        const parent = pick(expenseParents, random)
        const child = parent.children.length > 0 ? pick(parent.children, random) : undefined
        const amount = [1200, 1850, 2800, 3200, 4580, 6800, 12800, 29900][Math.floor(random() * 8)]
        const note = pick(NOTES, random)
        recordsRepo.create({
          date,
          amount,
          type: 'expense',
          channel: pick(['offline', 'online', 'dining'], random),
          categoryId: child?.id ?? parent.id,
          accountId: pick(accounts, random).id,
          toAccountId: null,
          note,
          noteColor: null,
          tags: []
        })
        count += 1
      }
    }

    // 偶尔一笔转账
    if (accounts.length >= 2) {
      recordsRepo.create({
        date: addDays(today, -3),
        amount: 50000,
        type: 'transfer',
        channel: 'transfer',
        categoryId: null,
        accountId: accounts[0].id,
        toAccountId: accounts[1].id,
        note: '还信用卡',
        noteColor: null,
        tags: []
      })
      count += 1
    }
  })
  run()

  const rules = [
    recurringRepo.create({
      name: '每月房租',
      amount: 250000,
      type: 'expense',
      categoryId: expenseParents.find((node) => node.name === '居住')?.id ?? expenseParents[0].id,
      accountId: accounts[0].id,
      toAccountId: null,
      frequency: 'monthly',
      interval: 1,
      startDate: `${startMonth}-01`,
      endDate: null,
      enabled: true
    }),
    recurringRepo.create({
      name: '每周健身',
      amount: 20000,
      type: 'expense',
      categoryId: expenseParents.find((node) => node.name === '娱乐')?.id ?? expenseParents[0].id,
      accountId: accounts[0].id,
      toAccountId: null,
      frequency: 'weekly',
      interval: 1,
      startDate: addDays(today, -30),
      endDate: null,
      enabled: true
    })
  ]

  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('demoSeeded', '1', ?)
     ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`
  ).run(Date.now())

  return { seeded: true, records: count, rules: rules.length }
}
