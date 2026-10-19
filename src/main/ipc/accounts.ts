import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  Account,
  AccountInput,
  AccountUsage,
  AccountWithBalance,
  MigrateResult,
  WriteResult
} from '@shared/types'
import * as repo from '../db/repositories/accounts.repo'
import { assertReady } from './guard'

function validate(input: AccountInput): void {
  if (!input.name || !input.name.trim()) throw new Error('账户名称不能为空')
  if (input.name.trim().length > 20) throw new Error('账户名称请控制在 20 字以内')
  if (!Number.isInteger(input.initialBalance)) throw new Error('初始余额必须是整数分')
}

export function registerAccountsIpc(): void {
  ipcMain.handle(IPC.accountsList, (_event, includeArchived?: boolean): AccountWithBalance[] => {
    assertReady()
    return repo.listWithBalance(Boolean(includeArchived))
  })

  ipcMain.handle(IPC.accountsListArchived, (): AccountWithBalance[] => {
    assertReady()
    return repo.listWithBalance(true).filter((account) => account.isArchived)
  })

  ipcMain.handle(IPC.accountsCreate, (_event, input: AccountInput): Account => {
    assertReady()
    validate(input)
    if (repo.nameExists(input.name.trim())) throw new Error('已存在同名账户')
    return repo.create(input)
  })

  ipcMain.handle(IPC.accountsUpdate, (_event, id: string, input: AccountInput): Account => {
    assertReady()
    validate(input)
    if (!repo.get(id)) throw new Error('账户不存在')
    if (repo.nameExists(input.name.trim(), id)) throw new Error('已存在同名账户')
    return repo.update(id, input)
  })

  ipcMain.handle(IPC.accountsUsage, (_event, id: string): AccountUsage => {
    assertReady()
    if (!repo.get(id)) throw new Error('账户不存在')
    return repo.usage(id)
  })

  ipcMain.handle(IPC.accountsRemove, (_event, id: string): WriteResult => {
    assertReady()
    return repo.remove(id)
  })

  ipcMain.handle(IPC.accountsArchive, (_event, id: string): WriteResult => {
    assertReady()
    return repo.archive(id)
  })

  ipcMain.handle(IPC.accountsRestore, (_event, id: string): WriteResult => {
    assertReady()
    return repo.restore(id)
  })

  ipcMain.handle(IPC.accountsMigrate, (_event, sourceId: string, targetId: string): MigrateResult => {
    assertReady()
    return repo.migrateAndArchive(sourceId, targetId)
  })
}
