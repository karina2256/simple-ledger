import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Budget, BudgetInput, BudgetWithProgress, WriteResult } from '@shared/types'
import * as budgetsRepo from '../db/repositories/budgets.repo'
import { assertReady } from './guard'

export function registerBudgetsIpc(): void {
  ipcMain.handle(IPC.budgetsList, (): BudgetWithProgress[] => {
    assertReady()
    return budgetsRepo.list()
  })

  ipcMain.handle(IPC.budgetsCreate, (_event, input: BudgetInput): Budget => {
    assertReady()
    if (!input || !Number.isFinite(input.amount) || input.amount <= 0) throw new Error('预算金额要大于 0')
    if (budgetsRepo.exists(input.categoryId ?? null, input.period)) {
      throw new Error('这个分类已经有一条同周期的预算了，直接改那条就行')
    }
    return budgetsRepo.create({ ...input, categoryId: input.categoryId ?? null })
  })

  ipcMain.handle(IPC.budgetsUpdate, (_event, id: string, input: BudgetInput): Budget => {
    assertReady()
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('预算金额要大于 0')
    if (budgetsRepo.exists(input.categoryId ?? null, input.period, id)) {
      throw new Error('这个分类已经有一条同周期的预算了')
    }
    return budgetsRepo.update(id, { ...input, categoryId: input.categoryId ?? null })
  })

  ipcMain.handle(IPC.budgetsRemove, (_event, id: string): WriteResult => {
    assertReady()
    return budgetsRepo.remove(id)
  })
}
