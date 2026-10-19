import { randomUUID } from 'node:crypto'
import { getDb } from './connection'
import {
  DEFAULT_ACCOUNTS,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  type SeedCategory
} from '@shared/constants'
import * as settingsRepo from './repositories/settings.repo'

/** 起始账本：预设模板 / 空白 */
export type SeedMode = 'template' | 'blank'

/**
 * 写入初始账户与分类。只在首次初始化时跑一次，靠 settings.seeded 标记防重复。
 *
 * 两种模式（引导页里让用户选，避免把「预设分类」误会成别人的历史数据）：
 *  - template：微信/支付宝 + 55 个常用分类
 *  - blank  ：只给一个「现金」账户，分类留空自己加
 *    （不能真的一点都不建：没有任何账户时记不了账，用户会以为软件坏了）
 */
export function seedIfNeeded(mode: SeedMode = 'template'): boolean {
  if (settingsRepo.hasSeedMark()) return false
  const db = getDb()

  const insertAccount = db.prepare(
    `INSERT INTO accounts (id, name, icon, color, initial_balance, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertCategory = db.prepare(
    `INSERT INTO categories (id, parent_id, name, icon, color, type, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const run = db.transaction(() => {
    const ts = Date.now()

    if (mode === 'blank') {
      insertAccount.run(randomUUID(), '现金', 'wallet', '#4FB3A5', 0, 0, ts, ts)
    } else {
      DEFAULT_ACCOUNTS.forEach((account, index) => {
        insertAccount.run(randomUUID(), account.name, account.icon, account.color, account.initialBalance, index, ts, ts)
      })
    }

    if (mode === 'template') {
      const insertTree = (tree: SeedCategory[], type: 'income' | 'expense'): void => {
        tree.forEach((parent, parentIndex) => {
          const parentId = randomUUID()
          insertCategory.run(parentId, null, parent.name, parent.icon, parent.color, type, parentIndex, ts, ts)
          parent.children.forEach((child, childIndex) => {
            insertCategory.run(
              randomUUID(),
              parentId,
              child.name,
              child.icon,
              parent.color,
              type,
              childIndex,
              ts,
              ts
            )
          })
        })
      }
      insertTree(DEFAULT_EXPENSE_CATEGORIES, 'expense')
      insertTree(DEFAULT_INCOME_CATEGORIES, 'income')
    }
  })

  run()
  settingsRepo.markSeeded()
  return true
}
