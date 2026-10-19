import * as accountsRepo from './db/repositories/accounts.repo'
import * as categoriesRepo from './db/repositories/categories.repo'
import * as recordsRepo from './db/repositories/records.repo'
import { finishProbe, type ProbeResult } from './probe-report'
import { dbPath, getDataDir } from './paths'

/** 打包持久化自检用的固定备注，便于两次运行之间对得上 */
const NOTE = '打包持久化自检'

/**
 * 打包版持久化探针：
 *   LEDGER_PERSIST_PROBE=write  写一笔记录后退出
 *   LEDGER_PERSIST_PROBE=check  重启后再读一次，确认记录还在
 */
export function runPersistProbe(mode: string): number {
  const results: ProbeResult[] = []
  const check = (name: string, ok: boolean, detail: unknown): void => {
    results.push({ name, ok, detail: String(detail) })
  }

  check('数据库文件存在', true, dbPath(getDataDir()))

  if (mode === 'write') {
    const accounts = accountsRepo.list()
    const tree = categoriesRepo.tree()
    const expense = tree.find((node) => node.type === 'expense')
    check('预设账户已就绪', accounts.length >= 2, accounts.map((item) => item.name).join('/'))
    check('预设分类已就绪', Boolean(expense), `${tree.length} 个一级分类`)

    const record = recordsRepo.create({
      date: new Date().toISOString().slice(0, 10),
      amount: 2880,
      type: 'expense',
      channel: 'dining',
      categoryId: expense?.children[0]?.id ?? expense?.id ?? null,
      accountId: accounts[0].id,
      toAccountId: null,
      note: NOTE,
      noteColor: null,
      tags: ['打包自检']
    })
    check('写入一笔记录', Boolean(record.id), record.id)

    const after = recordsRepo.list({ keyword: NOTE })
    check('写入后立刻能查到', after.total === 1, `${after.total} 笔`)

    const balances = accountsRepo.listWithBalance()
    check('余额随记录变化', balances[0].balance === -2880, balances[0].balance)
  } else {
    const list = recordsRepo.list({ keyword: NOTE })
    check('重启后记录仍在', list.total === 1, `${list.total} 笔`)
    check(
      '金额与备注完好',
      list.items[0]?.amount === 2880 && list.items[0]?.note === NOTE,
      `${list.items[0]?.amount} / ${list.items[0]?.note}`
    )
    check('标签完好', list.items[0]?.tags.includes('打包自检') === true, list.items[0]?.tags.join(','))
  }

  return finishProbe(`打包持久化自检（${mode}）`, results)
}
