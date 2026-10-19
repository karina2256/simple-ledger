import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { RecurringInput, RecurringRule, WriteResult } from '@shared/types'
import * as repo from '../db/repositories/recurring.repo'
import * as accountsRepo from '../db/repositories/accounts.repo'
import * as categoriesRepo from '../db/repositories/categories.repo'
import { assertReady } from './guard'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly']

function validate(input: RecurringInput): void {
  if (!input.name || !input.name.trim()) throw new Error('规则名称不能为空')
  if (input.name.trim().length > 30) throw new Error('规则名称请控制在 30 字以内')
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error('金额不正确')
  if (!['income', 'expense', 'transfer'].includes(input.type)) throw new Error('记录类型不合法')
  if (!FREQUENCIES.includes(input.frequency)) throw new Error('频率不合法')
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > 365) {
    throw new Error('间隔需要是 1 到 365 之间的整数')
  }
  if (!DATE_RE.test(input.startDate)) throw new Error('开始日期格式不正确')
  if (input.endDate && !DATE_RE.test(input.endDate)) throw new Error('结束日期格式不正确')
  if (input.endDate && input.endDate < input.startDate) throw new Error('结束日期不能早于开始日期')
  if (!input.accountId) throw new Error('请选择账户')
  if (!accountsRepo.get(input.accountId)) throw new Error('账户不存在')

  if (input.type === 'transfer') {
    if (!input.toAccountId) throw new Error('请选择转入账户')
    if (input.toAccountId === input.accountId) throw new Error('转出与转入账户不能相同')
    if (!accountsRepo.get(input.toAccountId)) throw new Error('转入账户不存在')
  } else if (input.categoryId) {
    const category = categoriesRepo.get(input.categoryId)
    if (!category) throw new Error('分类不存在')
    if (category.isArchived) throw new Error('该分类已归档，请重新选择')
    if (category.type !== input.type) throw new Error('分类类型与规则类型不一致')
  }
}

export function registerRecurringIpc(): void {
  ipcMain.handle(IPC.recurringList, (): RecurringRule[] => {
    assertReady()
    return repo.list()
  })

  ipcMain.handle(IPC.recurringCreate, (_event, input: RecurringInput): RecurringRule => {
    assertReady()
    validate(input)
    return repo.create(input)
  })

  ipcMain.handle(IPC.recurringUpdate, (_event, id: string, input: RecurringInput): RecurringRule => {
    assertReady()
    validate(input)
    if (!repo.get(id)) throw new Error('规则不存在')
    return repo.update(id, input)
  })

  ipcMain.handle(IPC.recurringToggle, (_event, id: string, enabled: boolean): RecurringRule => {
    assertReady()
    if (!repo.get(id)) throw new Error('规则不存在')
    return repo.setEnabled(id, Boolean(enabled))
  })

  ipcMain.handle(IPC.recurringRemove, (_event, id: string): WriteResult => {
    assertReady()
    return repo.remove(id)
  })
}
