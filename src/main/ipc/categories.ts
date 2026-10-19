import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Category, CategoryInput, CategoryNode, CategoryUsage, MigrateResult, WriteResult } from '@shared/types'
import * as repo from '../db/repositories/categories.repo'
import { assertReady } from './guard'

function validate(input: CategoryInput): void {
  if (!input.name || !input.name.trim()) throw new Error('分类名称不能为空')
  if (input.name.trim().length > 20) throw new Error('分类名称请控制在 20 字以内')
  if (input.type !== 'income' && input.type !== 'expense') throw new Error('分类类型不合法')
}

export function registerCategoriesIpc(): void {
  ipcMain.handle(IPC.categoriesTree, (_event, includeArchived?: boolean): CategoryNode[] => {
    assertReady()
    return repo.tree(Boolean(includeArchived))
  })

  ipcMain.handle(IPC.categoriesCreate, (_event, input: CategoryInput): Category => {
    assertReady()
    validate(input)
    if (input.parentId) {
      const parent = repo.get(input.parentId)
      if (!parent) throw new Error('上级分类不存在')
      if (parent.parentId !== null) throw new Error('只支持两级分类')
      if (parent.isArchived) throw new Error('上级分类处于归档状态，不能往里加子分类')
    }
    if (repo.nameExists(input.name.trim(), input.type, input.parentId)) throw new Error('同级下已存在同名分类')
    return repo.create(input)
  })

  ipcMain.handle(IPC.categoriesUpdate, (_event, id: string, input: CategoryInput): Category => {
    assertReady()
    validate(input)
    const current = repo.get(id)
    if (!current) throw new Error('分类不存在')
    if (input.parentId === id) throw new Error('分类不能以自己为上级')
    if (repo.nameExists(input.name.trim(), input.type, input.parentId, id)) throw new Error('同级下已存在同名分类')
    return repo.update(id, input)
  })

  ipcMain.handle(IPC.categoriesUsage, (_event, id: string): CategoryUsage => {
    assertReady()
    if (!repo.get(id)) throw new Error('分类不存在')
    return repo.usage(id)
  })

  ipcMain.handle(IPC.categoriesRemove, (_event, id: string): WriteResult => {
    assertReady()
    return repo.remove(id)
  })

  ipcMain.handle(IPC.categoriesArchive, (_event, id: string): MigrateResult => {
    assertReady()
    return repo.archive(id)
  })

  ipcMain.handle(IPC.categoriesRestore, (_event, id: string): WriteResult => {
    assertReady()
    return repo.restore(id)
  })

  ipcMain.handle(IPC.categoriesMigrate, (_event, sourceId: string, targetId: string): MigrateResult => {
    assertReady()
    return repo.migrateAndArchive(sourceId, targetId)
  })
}
