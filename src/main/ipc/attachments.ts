import { ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { Attachment, WriteResult } from '@shared/types'
import * as recordsRepo from '../db/repositories/records.repo'
import * as attachmentsRepo from '../db/repositories/attachments.repo'
import { addAttachments, pickImages, removeAttachment, resolveAttachmentPath } from '../services/attachment.service'
import { assertReady } from './guard'

export function registerAttachmentsIpc(): void {
  ipcMain.handle(IPC.attachmentsPickImages, async (): Promise<string[]> => {
    assertReady()
    return pickImages()
  })

  ipcMain.handle(IPC.attachmentsAdd, (_event, recordId: string, sourcePaths: string[]): Attachment[] => {
    assertReady()
    if (!recordsRepo.get(recordId)) throw new Error('记录不存在')
    if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) return []
    return addAttachments(recordId, sourcePaths)
  })

  ipcMain.handle(IPC.attachmentsRemove, (_event, id: string): WriteResult => {
    assertReady()
    return removeAttachment(id)
  })

  ipcMain.handle(IPC.attachmentsReveal, (_event, id: string): void => {
    assertReady()
    const target = attachmentsRepo.get(id)
    if (!target) return
    shell.showItemInFolder(resolveAttachmentPath(target.filePath))
  })
}
