import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { CsvImportCommitInput, CsvImportCommitResult, CsvImportPreview, ExchangeResult, RecordQuery } from '@shared/types'
import * as exchange from '../services/exchange.service'
import { assertReady } from './guard'

/**
 * 导入 / 导出的 IPC。
 *
 * 和账单截图一样分三段：选文件 → 解析预览（只读）→ 用户确认后才写库。
 */
export function registerExchangeIpc(): void {
  ipcMain.handle(
    IPC.exchangeExportCsv,
    async (_event, query: RecordQuery, format: 'csv' | 'xlsx' = 'csv'): Promise<ExchangeResult> => {
      assertReady()
      const stamp = new Date()
      const pad = (value: number): string => String(value).padStart(2, '0')
      const base = `记账簿-导出-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`
      const isXlsx = format === 'xlsx'

      const win = BrowserWindow.getFocusedWindow()
      const options = {
        title: isXlsx ? '导出为 Excel' : '导出为 CSV',
        defaultPath: `${base}.${isXlsx ? 'xlsx' : 'csv'}`,
        filters: isXlsx
          ? [
              { name: 'Excel 工作簿', extensions: ['xlsx'] },
              { name: '全部文件', extensions: ['*'] }
            ]
          : [
              { name: 'CSV 表格', extensions: ['csv'] },
              { name: '全部文件', extensions: ['*'] }
            ]
      }
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: false, message: '已取消' }

      try {
        if (isXlsx) {
          const rows = exchange.exportRows(query ?? {})
          const buffer = exchange.exportXlsx(query ?? {})
          return exchange.writeXlsxFile(result.filePath, buffer, rows.length)
        }
        const text = exchange.exportCsv(query ?? {})
        return exchange.writeCsvFile(result.filePath, text)
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(IPC.exchangePickCsv, async (): Promise<string | null> => {
    assertReady()
    const win = BrowserWindow.getFocusedWindow()
    const options = {
      title: '选择要导入的 CSV 文件',
      filters: [
        { name: 'CSV 表格', extensions: ['csv', 'txt'] },
        { name: '全部文件', extensions: ['*'] }
      ],
      properties: ['openFile'] as 'openFile'[]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.exchangePreviewCsv, (_event, filePath: string): CsvImportPreview => {
    assertReady()
    if (!filePath) throw new Error('没有选择文件')
    return exchange.previewCsv(filePath)
  })

  ipcMain.handle(IPC.exchangeCommitCsv, (_event, input: CsvImportCommitInput): CsvImportCommitResult => {
    assertReady()
    if (!input || !Array.isArray(input.rows) || input.rows.length === 0) throw new Error('没有可导入的行')
    return exchange.commitCsv(input)
  })
}
