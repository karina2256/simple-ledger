import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { BillShotCommitInput, BillShotCommitResult, BillShotPreview } from '@shared/types'
import * as billShot from '../services/billshot.service'
import { assertReady } from './guard'

/**
 * 账单截图导入的 IPC。
 *
 * 三个阶段分开，是为了保证「识别」和「写库」之间有一个人工确认的闸门：
 *   pick    → 选图
 *   preview → 解析成候选（只读，绝不写库）
 *   commit  → 用户确认后才入库
 */
export function registerBillShotIpc(): void {
  const filters = [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]

  ipcMain.handle(IPC.billShotPick, async (): Promise<string[]> => {
    assertReady()
    const win = BrowserWindow.getFocusedWindow()
    const options = {
      title: '选择账单截图（可多选）',
      filters,
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(IPC.billShotPreview, async (_event, filePaths: string[]): Promise<BillShotPreview> => {
    assertReady()
    if (!Array.isArray(filePaths) || filePaths.length === 0) throw new Error('请先选择账单截图')
    // 真图走 OCR；读不出文字时由服务层给出明确告警，不做任何猜测
    return billShot.previewWithOcr(filePaths)
  })

  ipcMain.handle(IPC.billShotCommit, (_event, input: BillShotCommitInput): BillShotCommitResult => {
    assertReady()
    if (!input || !Array.isArray(input.items) || input.items.length === 0) throw new Error('没有可导入的记录')
    const result = billShot.commit(input)
    // 记住这次的分类映射，下次同一分类直接带上
    const entries: Record<string, string> = {}
    for (const item of input.items) {
      if (item.shotCategory && item.categoryId) entries[item.shotCategory] = item.categoryId
    }
    billShot.rememberMapping(entries)
    return result
  })
}
