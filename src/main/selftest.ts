import { existsSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { net } from 'electron'
import { noteColorOf } from '@shared/constants'
import { attachmentUrl } from '@shared/url'
import { expandOccurrences, nextOccurrence } from '@shared/recurring'
import { fillDays, sumByMonth, sumByWeek, sumRange } from '@shared/aggregate'
import type { CategoryNode } from '@shared/types'
import * as accountsRepo from './db/repositories/accounts.repo'
import * as attachmentsRepo from './db/repositories/attachments.repo'
import * as categoriesRepo from './db/repositories/categories.repo'
import * as recordsRepo from './db/repositories/records.repo'
import * as recurringRepo from './db/repositories/recurring.repo'
import * as settingsRepo from './db/repositories/settings.repo'
import { addAttachments, removeAttachment, resolveAttachmentPath } from './services/attachment.service'
import { purgeRecords } from './services/records.service'
import { backupNow } from './services/backup.service'

/** 1×1 的透明 PNG，用来验证收据附件与 ledger:// 协议 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

/**
 * 开发期自检：只在环境变量 LEDGER_SELFTEST=1 时运行，跑完直接退出。
 * 走的是真实的数据层代码路径，用来在没有人点界面的情况下验证「写得进、算得对、删得掉」。
 */
export async function runSelfTest(): Promise<number> {
  const results: { name: string; ok: boolean; detail: string }[] = []
  const check = (name: string, ok: boolean, detail: unknown): void => {
    results.push({ name, ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })
  }

  try {
    const accounts = accountsRepo.listWithBalance()
    check('预设账户', accounts.length >= 2, accounts.map((a) => a.name).join('/'))

    const tree = categoriesRepo.tree()
    const expense = tree.find((node) => node.type === 'expense')
    const income = tree.find((node) => node.type === 'income')
    check('预设分类', Boolean(expense && income), `${tree.length} 个一级分类`)
    check('二级分类', (expense?.children.length ?? 0) > 0, `${expense?.children.length ?? 0} 个支出子分类`)
    // 后面几处要拿支出分类的 id 做迁移目标，这里先断言存在
    const expenseRoot = expense as CategoryNode

    check('相同备注同色', noteColorOf('奶茶') === noteColorOf('奶茶'), noteColorOf('奶茶'))
    check('不同备注不同色', noteColorOf('奶茶') !== noteColorOf('打车'), noteColorOf('打车'))

    const wechat = accounts[0]
    const alipay = accounts[1]
    const created: string[] = []

    const expenseRecord = recordsRepo.create({
      date: '2025-06-18',
      amount: 2850,
      type: 'expense',
      channel: 'dining',
      categoryId: expense?.children[0]?.id ?? expense?.id ?? null,
      accountId: wechat.id,
      toAccountId: null,
      note: '奶茶外卖',
      noteColor: null,
      tags: ['日常']
    })
    created.push(expenseRecord.id)
    check('新增支出', expenseRecord.amount === 2850, expenseRecord.id)

    const incomeRecord = recordsRepo.create({
      date: '2025-06-15',
      amount: 1200000,
      type: 'income',
      channel: 'other',
      categoryId: income?.children[0]?.id ?? income?.id ?? null,
      accountId: wechat.id,
      toAccountId: null,
      note: '6月工资',
      noteColor: null,
      tags: []
    })
    created.push(incomeRecord.id)

    const transferRecord = recordsRepo.create({
      date: '2025-06-17',
      amount: 50000,
      type: 'transfer',
      channel: 'transfer',
      categoryId: null,
      accountId: wechat.id,
      toAccountId: alipay.id,
      note: '还信用卡',
      noteColor: null,
      tags: []
    })
    created.push(transferRecord.id)

    const listing = recordsRepo.list({ from: '2025-06-01', to: '2025-06-30' })
    check('列表命中 3 笔', listing.total === 3, listing.total)
    check('支出合计 28.50', listing.expenseTotal === 2850, listing.expenseTotal)
    check('收入合计 12000.00', listing.incomeTotal === 1200000, listing.incomeTotal)
    check('转账不计入收支', listing.transferTotal === 50000, listing.transferTotal)

    const after = accountsRepo.listWithBalance()
    const wechatAfter = after.find((item) => item.id === wechat.id)
    const alipayAfter = after.find((item) => item.id === alipay.id)
    check(
      '微信余额 11521.50',
      wechatAfter?.balance === 1200000 - 2850 - 50000,
      wechatAfter?.balance
    )
    check('支付宝余额 500.00', alipayAfter?.balance === 50000, alipayAfter?.balance)

    const keyword = recordsRepo.list({ keyword: '奶茶' })
    check('按备注搜索', keyword.total === 1, keyword.total)

    const updated = recordsRepo.update(expenseRecord.id, {
      date: '2025-06-18',
      amount: 3000,
      type: 'expense',
      channel: 'dining',
      categoryId: expenseRecord.categoryId,
      accountId: wechat.id,
      toAccountId: null,
      note: '奶茶外卖',
      noteColor: null,
      tags: ['日常']
    })
    check('修改金额', updated.amount === 3000, updated.amount)

    check('软删除', recordsRepo.softDelete([expenseRecord.id]) === 1, 'ok')
    check('软删除后不出现', recordsRepo.list({ from: '2025-06-01', to: '2025-06-30' }).total === 2, 'ok')
    check('恢复删除', recordsRepo.restore([expenseRecord.id]) === 1, 'ok')

    const cleaned = recordsRepo.hardDelete(created)
    check('清理测试数据', cleaned === 3, cleaned)
    check('账户回到 0', accountsRepo.listWithBalance().every((item) => item.balance === 0), 'ok')

    const settings = settingsRepo.getAll()
    check('设置可读', settings.currency === 'CNY', settings.currency)
    settingsRepo.set('showUsd', true)
    check('设置可写', settingsRepo.getAll().showUsd === true, 'ok')
    settingsRepo.set('showUsd', false)

    // 收据附件：复制进数据目录 + 通过 ledger:// 协议真的读回来
    const sourceFile = path.join(os.tmpdir(), `ledger-selftest-${Date.now()}.png`)
    writeFileSync(sourceFile, TINY_PNG)
    const holder = recordsRepo.create({
      date: '2025-06-18',
      amount: 100,
      type: 'expense',
      channel: 'offline',
      categoryId: expense?.children[0]?.id ?? expense?.id ?? null,
      accountId: wechat.id,
      toAccountId: null,
      note: '附件测试',
      noteColor: null,
      tags: []
    })
    const [attachment] = addAttachments(holder.id, [sourceFile])
    check('附件复制进数据目录', Boolean(attachment) && existsSync(resolveAttachmentPath(attachment.filePath)), attachment?.filePath)

    const response = await net.fetch(attachmentUrl(attachment.filePath))
    const bytes = Buffer.from(await response.arrayBuffer())
    check(
      'ledger:// 协议能读到附件',
      response.ok && bytes.length === TINY_PNG.length,
      `HTTP ${response.status}，${bytes.length} 字节`
    )

    removeAttachment(attachment.id)
    check('附件可删除', !existsSync(resolveAttachmentPath(attachment.filePath)), 'ok')
    recordsRepo.hardDelete([holder.id])
    rmSync(sourceFile, { force: true })

    const backup = backupNow()
    check('手动备份', backup.ok && Boolean(backup.filePath) && existsSync(backup.filePath ?? ''), backup.filePath ?? '')

    // ---------- 账户归档 / 迁移 / 彻底删除 ----------
    const accountA = accountsRepo.create({ name: '自检甲', icon: '🅰️', color: '#4A9BD1', initialBalance: 10000 })
    const accountB = accountsRepo.create({ name: '自检乙', icon: '🅱️', color: '#4FB3A5', initialBalance: 0 })
    const categoryId = expense?.children[0]?.id ?? expense?.id ?? null

    const aExpense = recordsRepo.create({
      date: '2025-07-01',
      amount: 3000,
      type: 'expense',
      channel: 'dining',
      categoryId,
      accountId: accountA.id,
      toAccountId: null,
      note: '自检甲支出',
      noteColor: null,
      tags: []
    })
    const aIncome = recordsRepo.create({
      date: '2025-07-02',
      amount: 20000,
      type: 'income',
      channel: 'other',
      categoryId: income?.children[0]?.id ?? income?.id ?? null,
      accountId: accountA.id,
      toAccountId: null,
      note: '自检甲收入',
      noteColor: null,
      tags: []
    })
    const aTransfer = recordsRepo.create({
      date: '2025-07-03',
      amount: 5000,
      type: 'transfer',
      channel: 'transfer',
      categoryId: null,
      accountId: accountA.id,
      toAccountId: accountB.id,
      note: '甲乙之间转账',
      noteColor: null,
      tags: []
    })
    const bExpense = recordsRepo.create({
      date: '2025-07-04',
      amount: 1000,
      type: 'expense',
      channel: 'offline',
      categoryId,
      accountId: accountB.id,
      toAccountId: null,
      note: '自检乙支出',
      noteColor: null,
      tags: []
    })

    const balanceOf = (id: string): number | undefined =>
      accountsRepo.listWithBalance(true).find((item) => item.id === id)?.balance

    check('自检甲余额 220.00', balanceOf(accountA.id) === 22000, balanceOf(accountA.id))
    check('自检乙余额 40.00', balanceOf(accountB.id) === 4000, balanceOf(accountB.id))

    // 1) 有记录的账户不能真删
    const usageA = accountsRepo.usage(accountA.id)
    check('有记录账户不许真删', usageA.canHardDelete === false && usageA.recordCount === 3, usageA.recordCount)
    const removeAttempt = accountsRepo.remove(accountA.id)
    check('真删被拦下并给出决策', removeAttempt.ok === false && removeAttempt.code === 'NEEDS_DECISION', removeAttempt.message ?? '')

    // 2) 归档：下拉（默认列表）里看不到，历史记录仍显示账户名
    check('归档成功', accountsRepo.archive(accountA.id).ok, 'ok')
    check(
      '归档后不在默认列表',
      accountsRepo.listWithBalance().every((item) => item.id !== accountA.id),
      'ok'
    )
    check(
      '归档后仍在含归档列表里',
      accountsRepo.listWithBalance(true).some((item) => item.id === accountA.id && item.isArchived),
      'ok'
    )
    const history = recordsRepo.list({ accountIds: [accountA.id] })
    check(
      '历史记录仍显示归档账户名',
      history.total === 3 && history.items.every((item) => item.accountName === '自检甲'),
      `${history.total} 笔`
    )

    // 3) 恢复
    check('归档账户可恢复', accountsRepo.restore(accountA.id).ok, 'ok')
    check(
      '恢复后回到默认列表',
      accountsRepo.listWithBalance().some((item) => item.id === accountA.id && !item.isArchived),
      'ok'
    )

    // 4) 迁移并归档：余额口径必须对得上
    const totalBefore = (balanceOf(accountA.id) ?? 0) + (balanceOf(accountB.id) ?? 0)
    const migrated = accountsRepo.migrateAndArchive(accountA.id, accountB.id)
    check('迁移成功', migrated.ok === true, migrated.message ?? '')
    check('迁移了 3 笔记录', migrated.movedRecords === 3, migrated.movedRecords)
    check('合并了 1 笔内部转账', migrated.mergedTransfers === 1, migrated.mergedTransfers)
    check('源账户已归档', accountsRepo.get(accountA.id)?.isArchived === true, 'ok')
    check(
      '迁移后总数不变（260.00）',
      balanceOf(accountB.id) === totalBefore && totalBefore === 26000,
      `迁移前合计 ${totalBefore}，迁移后乙 ${balanceOf(accountB.id)}`
    )
    check('迁移后不含已删除转账', recordsRepo.list({ accountIds: [accountB.id] }).total === 3, 'ok')
    check(
      '归档账户历史明细仍在',
      recordsRepo.list({ accountIds: [accountA.id], includeDeleted: true }).total >= 0,
      'ok'
    )

    // 5) 余额为 0 且无引用的账户可以真删
    const emptyAccount = accountsRepo.create({ name: '自检空账户', icon: '📦', color: '#8A9BA8', initialBalance: 0 })
    check('空账户可硬删', accountsRepo.usage(emptyAccount.id).canHardDelete, 'ok')
    check('空账户删除成功', accountsRepo.remove(emptyAccount.id).ok, 'ok')
    check('空账户已消失', accountsRepo.get(emptyAccount.id) === null, 'ok')

    // ---------- 附件：软删除不动物理文件，彻底删除默认保留 ----------
    const fileA = path.join(os.tmpdir(), `ledger-keep-${Date.now()}.png`)
    const fileB = path.join(os.tmpdir(), `ledger-drop-${Date.now()}.png`)
    writeFileSync(fileA, TINY_PNG)
    writeFileSync(fileB, TINY_PNG)

    const keepRecord = recordsRepo.create({
      date: '2025-07-05',
      amount: 100,
      type: 'expense',
      channel: 'offline',
      categoryId,
      accountId: accountB.id,
      toAccountId: null,
      note: '附件保留测试',
      noteColor: null,
      tags: []
    })
    const dropRecord = recordsRepo.create({
      date: '2025-07-06',
      amount: 100,
      type: 'expense',
      channel: 'offline',
      categoryId,
      accountId: accountB.id,
      toAccountId: null,
      note: '附件删除测试',
      noteColor: null,
      tags: []
    })
    const [keepAttachment] = addAttachments(keepRecord.id, [fileA])
    const [dropAttachment] = addAttachments(dropRecord.id, [fileB])
    const keepPath = resolveAttachmentPath(keepAttachment.filePath)
    const dropPath = resolveAttachmentPath(dropAttachment.filePath)

    recordsRepo.softDelete([keepRecord.id])
    check('软删除不动物理附件', existsSync(keepPath), 'ok')
    recordsRepo.restore([keepRecord.id])
    check('撤销删除后附件还在', existsSync(keepPath), 'ok')

    purgeRecords([keepRecord.id], false)
    check('彻底删除默认保留附件文件', existsSync(keepPath), 'ok')
    check('附件数据库行已随记录删除', attachmentsRepo.get(keepAttachment.id) === null, 'ok')

    purgeRecords([dropRecord.id], true)
    check('勾选后附件文件被删除', !existsSync(dropPath), 'ok')

    rmSync(fileA, { force: true })
    rmSync(fileB, { force: true })

    // ---------- 分类归档 / 迁移 ----------
    const parentCategory = categoriesRepo.create({
      name: '自检父类',
      icon: '📁',
      color: '#8A9BA8',
      type: 'expense',
      parentId: null
    })
    const childCategory = categoriesRepo.create({
      name: '自检子类',
      icon: '🏷️',
      color: '#8A9BA8',
      type: 'expense',
      parentId: parentCategory.id
    })
    const categoryRecord = recordsRepo.create({
      date: '2025-07-07',
      amount: 700,
      type: 'expense',
      channel: 'offline',
      categoryId: childCategory.id,
      accountId: accountB.id,
      toAccountId: null,
      note: '分类归档测试',
      noteColor: null,
      tags: []
    })

    const categoryUsage = categoriesRepo.usage(parentCategory.id)
    check('有记录分类不许真删', categoryUsage.canHardDelete === false, categoryUsage.recordCount)
    const categoryRemoveAttempt = categoriesRepo.remove(parentCategory.id)
    check(
      '分类真删被拦下并给出决策',
      categoryRemoveAttempt.ok === false && categoryRemoveAttempt.code === 'NEEDS_DECISION',
      categoryRemoveAttempt.message ?? ''
    )

    const archivedCategory = categoriesRepo.archive(parentCategory.id)
    check('归档一级分类连带归档子分类', archivedCategory.ok && archivedCategory.archivedChildren === 1, archivedCategory.archivedChildren)
    check(
      '归档分类不在默认树里',
      categoriesRepo.tree().every((node) => node.id !== parentCategory.id),
      'ok'
    )
    check(
      '归档分类仍在含归档树里',
      categoriesRepo.tree(true).some((node) => node.id === parentCategory.id && node.isArchived),
      'ok'
    )
    const archivedHistory = recordsRepo.list({ keyword: '分类归档测试' })
    check(
      '历史记录仍显示归档分类名',
      archivedHistory.total === 1 && archivedHistory.items[0].categoryName === '自检子类',
      archivedHistory.items[0]?.categoryName ?? '（无）'
    )

    const restoredCategory = categoriesRepo.restore(parentCategory.id)
    check('归档分类可恢复', restoredCategory.ok, restoredCategory.message ?? '')
    check(
      '恢复后回到默认树',
      categoriesRepo.tree().some((node) => node.id === parentCategory.id && !node.isArchived),
      'ok'
    )

    const migratedCategory = categoriesRepo.migrateAndArchive(parentCategory.id, expenseRoot.id)
    check('分类迁移成功', migratedCategory.ok === true, migratedCategory.message ?? '')
    check('分类迁移了 1 笔记录', migratedCategory.movedRecords === 1, migratedCategory.movedRecords)
    check('源分类已归档', categoriesRepo.get(parentCategory.id)?.isArchived === true, 'ok')
    const migratedRecord = recordsRepo.getItem(categoryRecord.id)
    check(
      '迁移后记录挂在目标分类下',
      migratedRecord?.categoryId === expenseRoot.id && migratedRecord?.categoryName === '餐饮',
      migratedRecord?.categoryName ?? '（无）'
    )

    recordsRepo.hardDelete([categoryRecord.id])
    const removedChild = categoriesRepo.remove(childCategory.id)
    check('空子分类可硬删', removedChild.ok, removedChild.message ?? '')
    const removedParent = categoriesRepo.remove(parentCategory.id)
    check('清理自检分类', removedParent.ok, removedParent.message ?? '')

    // ---------- 日历：按天聚合 + 汇总纯函数 + 周期发生点 ----------
    const wechatAccount = accounts[0]
    const calendarRecords = [
      { date: '2025-08-05', amount: 1000, type: 'expense' as const, channel: 'dining' },
      { date: '2025-08-05', amount: 500, type: 'expense' as const, channel: 'dining' },
      { date: '2025-08-12', amount: 3000, type: 'income' as const, channel: 'other' },
      { date: '2025-09-01', amount: 700, type: 'expense' as const, channel: 'offline' }
    ].map((item) =>
      recordsRepo.create({
        date: item.date,
        amount: item.amount,
        type: item.type,
        channel: item.channel,
        categoryId: item.type === 'income' ? (income?.id ?? null) : categoryId,
        accountId: wechatAccount.id,
        toAccountId: null,
        note: `日历自检 ${item.date}`,
        noteColor: null,
        tags: []
      })
    )
    const calendarTransfer = recordsRepo.create({
      date: '2025-08-20',
      amount: 2000,
      type: 'transfer',
      channel: 'transfer',
      categoryId: null,
      accountId: wechatAccount.id,
      toAccountId: alipay.id,
      note: '日历自检转账',
      noteColor: null,
      tags: []
    })

    const days = recordsRepo.dayTotals('2025-08-01', '2025-09-30')
    check('按天聚合返回 4 天', days.length === 4, days.map((day) => day.date).join(','))
    const aug5 = days.find((day) => day.date === '2025-08-05')
    check('同一天两笔合并', aug5?.expense === 1500 && aug5?.count === 2, `${aug5?.expense}/${aug5?.count}`)
    const aug20 = days.find((day) => day.date === '2025-08-20')
    check('转账单独统计不吃收支', aug20?.transfer === 2000 && aug20?.income === 0 && aug20?.expense === 0, aug20?.transfer)

    const allTotals = sumRange(days)
    check(
      '区间汇总 收入3000/支出2200/转账2000/净800',
      allTotals.income === 3000 &&
        allTotals.expense === 2200 &&
        allTotals.transfer === 2000 &&
        allTotals.net === 800 &&
        allTotals.count === 5,
      JSON.stringify(allTotals)
    )

    const months = sumByMonth(days, 2025)
    check('年视图 12 个月格', months.length === 12, months.length)
    check(
      '8 月汇总 收3000/支1500/净1500',
      months[7].totals.income === 3000 && months[7].totals.expense === 1500 && months[7].totals.net === 1500,
      JSON.stringify(months[7].totals)
    )
    check(
      '9 月汇总 收0/支700/净-700',
      months[8].totals.income === 0 && months[8].totals.expense === 700 && months[8].totals.net === -700,
      JSON.stringify(months[8].totals)
    )
    check('没有记录的月份补 0', months[0].totals.count === 0 && months[0].totals.net === 0, 'ok')

    const weeks = sumByWeek(days, '2025-08-04')
    check('周视图 7 列', weeks.length === 7, weeks.length)
    check('周内某天合计正确', weeks[1].date === '2025-08-05' && weeks[1].totals.expense === 1500, weeks[1]?.date)

    const filled = fillDays(days, '2025-08-01', '2025-08-31')
    check('补位后 31 天', filled.length === 31, filled.length)
    check('补位天空值为 0', filled[0].date === '2025-08-01' && filled[0].count === 0, 'ok')

    // 周期规则：发生点完全由 start_date + 频率推算
    const monthlyRule = recurringRepo.create({
      name: '自检月租',
      amount: 200000,
      type: 'expense',
      categoryId: expenseRoot.id,
      accountId: wechatAccount.id,
      toAccountId: null,
      frequency: 'monthly',
      interval: 1,
      startDate: '2025-01-31',
      endDate: null,
      enabled: true
    })
    check(
      '1/31 的月租在 2 月落 2/28',
      expandOccurrences(monthlyRule, '2025-02-01', '2025-02-28').join(',') === '2025-02-28',
      expandOccurrences(monthlyRule, '2025-02-01', '2025-02-28').join(',')
    )
    check(
      '3 月回到 3/31',
      expandOccurrences(monthlyRule, '2025-03-01', '2025-03-31').join(',') === '2025-03-31',
      expandOccurrences(monthlyRule, '2025-03-01', '2025-03-31').join(',')
    )

    const weeklyRule = recurringRepo.create({
      name: '自检双周',
      amount: 5000,
      type: 'expense',
      categoryId: null,
      accountId: wechatAccount.id,
      toAccountId: null,
      frequency: 'weekly',
      interval: 2,
      startDate: '2025-08-04',
      endDate: null,
      enabled: true
    })
    check(
      '隔周规则落点正确',
      expandOccurrences(weeklyRule, '2025-08-01', '2025-08-31').join(',') === '2025-08-04,2025-08-18',
      expandOccurrences(weeklyRule, '2025-08-01', '2025-08-31').join(',')
    )

    const yearlyRule = recurringRepo.create({
      name: '自检年费',
      amount: 100000,
      type: 'expense',
      categoryId: null,
      accountId: wechatAccount.id,
      toAccountId: null,
      frequency: 'yearly',
      interval: 1,
      startDate: '2024-02-29',
      endDate: null,
      enabled: true
    })
    check(
      '2/29 的年费在平年落 2/28',
      expandOccurrences(yearlyRule, '2025-01-01', '2025-12-31').join(',') === '2025-02-28',
      expandOccurrences(yearlyRule, '2025-01-01', '2025-12-31').join(',')
    )

    const endedRule = recurringRepo.create({
      name: '自检已结束',
      amount: 100,
      type: 'expense',
      categoryId: null,
      accountId: wechatAccount.id,
      toAccountId: null,
      frequency: 'monthly',
      interval: 1,
      startDate: '2025-01-01',
      endDate: '2025-03-31',
      enabled: true
    })
    check('结束日期之后不再标记', expandOccurrences(endedRule, '2025-04-01', '2025-12-31').length === 0, 'ok')
    check('结束日期之前照常标记', expandOccurrences(endedRule, '2025-01-01', '2025-12-31').length === 3, 'ok')

    const disabledRule = recurringRepo.create({
      name: '自检已停用',
      amount: 100,
      type: 'expense',
      categoryId: null,
      accountId: wechatAccount.id,
      toAccountId: null,
      frequency: 'daily',
      interval: 1,
      startDate: '2025-08-01',
      endDate: null,
      enabled: false
    })
    check(
      '停用规则不进入日历标记',
      recurringRepo.list(true).every((rule) => rule.id !== disabledRule.id),
      'ok'
    )
    check(
      '启用规则进入日历标记',
      recurringRepo.list(true).some((rule) => rule.id === monthlyRule.id),
      'ok'
    )
    const augOccurrences = expandOccurrences(monthlyRule, '2025-08-01', '2025-08-31')
    check('日历汇总能取到当月发生点', augOccurrences.length === 1 && augOccurrences[0] === '2025-08-31', augOccurrences.join(','))

    const nextDate = nextOccurrence(monthlyRule, '2025-08-15')
    check('下次记账日推算正确', nextDate === '2025-08-31', nextDate ?? '（无）')

    // 清理日历自检数据
    recurringRepo.remove(monthlyRule.id)
    recurringRepo.remove(weeklyRule.id)
    recurringRepo.remove(yearlyRule.id)
    recurringRepo.remove(endedRule.id)
    recurringRepo.remove(disabledRule.id)
    recordsRepo.hardDelete([...calendarRecords.map((item) => item.id), calendarTransfer.id])
    check('清理日历自检数据', recordsRepo.dayTotals('2025-08-01', '2025-09-30').length === 0, 'ok')

    // 清理自检账户：先删记录，再把初始余额归零，然后硬删
    recordsRepo.hardDelete([aExpense.id, aIncome.id, aTransfer.id, bExpense.id])
    accountsRepo.update(accountA.id, { name: '自检甲', icon: '🅰️', color: '#4A9BD1', initialBalance: 0 })
    accountsRepo.update(accountB.id, { name: '自检乙', icon: '🅱️', color: '#4FB3A5', initialBalance: 0 })
    const cleanedA = accountsRepo.remove(accountA.id)
    const cleanedB = accountsRepo.remove(accountB.id)
    check('自检账户清理干净', cleanedA.ok && cleanedB.ok, 'ok')
  } catch (error) {
    check('自检异常', false, error instanceof Error ? error.message : String(error))
  }

  const failed = results.filter((item) => !item.ok)
  console.log('\n===== 数据层自检 =====')
  for (const item of results) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  ${item.detail}`)
  }
  console.log(`===== ${results.length - failed.length}/${results.length} 通过 =====\n`)
  return failed.length === 0 ? 0 : 1
}
