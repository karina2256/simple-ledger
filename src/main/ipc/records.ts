import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { LedgerRecord, RecordInput, RecordListItem, RecordListResult, RecordQuery, WriteResult } from '@shared/types'
import * as repo from '../db/repositories/records.repo'
import * as accountsRepo from '../db/repositories/accounts.repo'
import * as categoriesRepo from '../db/repositories/categories.repo'
import { assertReady } from './guard'
import { purgeRecords } from '../services/records.service'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validate(input: RecordInput): void {
  if (!DATE_RE.test(input.date)) throw new Error('日期格式不正确')
  if (!Number.isInteger(input.amount) || input.amount < 0) throw new Error('金额不正确')
  if (input.amount === 0) throw new Error('金额不能为 0')
  if (!['income', 'expense', 'transfer'].includes(input.type)) throw new Error('记录类型不合法')
  if (!input.accountId) throw new Error('请选择账户')
  if (!accountsRepo.get(input.accountId)) throw new Error('账户不存在')

  if (input.type === 'transfer') {
    if (!input.toAccountId) throw new Error('请选择转入账户')
    if (input.toAccountId === input.accountId) throw new Error('转出与转入账户不能相同')
    if (!accountsRepo.get(input.toAccountId)) throw new Error('转入账户不存在')
  } else if (!input.categoryId) {
    throw new Error('请选择分类')
  } else {
    const category = categoriesRepo.get(input.categoryId)
    if (!category) throw new Error('分类不存在')
    if (category.isArchived) throw new Error('该分类已归档，请重新选择')
    if (category.type !== input.type) throw new Error('分类类型与记录类型不一致')
  }
  if (input.note.length > 200) throw new Error('备注请控制在 200 字以内')
}

export function registerRecordsIpc(): void {
  ipcMain.handle(IPC.recordsList, (_event, query: RecordQuery): RecordListResult => {
    assertReady()
    return repo.list(query ?? {})
  })

  ipcMain.handle(IPC.recordsGet, (_event, id: string): RecordListItem | null => {
    assertReady()
    return repo.getItem(id)
  })

  ipcMain.handle(IPC.recordsCreate, (_event, input: RecordInput): LedgerRecord => {
    assertReady()
    validate(input)
    return repo.create(input)
  })

  ipcMain.handle(IPC.recordsUpdate, (_event, id: string, input: RecordInput): LedgerRecord => {
    assertReady()
    validate(input)
    if (!repo.get(id)) throw new Error('记录不存在')
    return repo.update(id, input)
  })

  ipcMain.handle(IPC.recordsRemove, (_event, ids: string[]): WriteResult => {
    assertReady()
    const changes = repo.softDelete(ids ?? [])
    return { ok: changes > 0, message: `已删除 ${changes} 笔` }
  })

  ipcMain.handle(IPC.recordsRestore, (_event, ids: string[]): WriteResult => {
    assertReady()
    const changes = repo.restore(ids ?? [])
    return { ok: changes > 0, message: `已恢复 ${changes} 笔` }
  })

  ipcMain.handle(IPC.recordsPurge, (_event, ids: string[], deleteAttachments: boolean): WriteResult => {
    assertReady()
    return purgeRecords(ids ?? [], Boolean(deleteAttachments))
  })
}
