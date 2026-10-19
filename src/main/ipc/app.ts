import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { statSync } from 'node:fs'
import { IPC } from '@shared/ipc'
import type { AppInfo, BackupInfo, BackupResult, BootstrapInfo } from '@shared/types'
import { defaultDataDir, dbPath, ensureDir, getDataDir, portableRoot, readConfig, writeConfig } from '../paths'
import { initDatabase } from '../db'
import { isOpen } from '../db/connection'
import * as settingsRepo from '../db/repositories/settings.repo'
import { backupInfo, backupNow } from '../services/backup.service'

export function bootstrapInfo(): BootstrapInfo {
  const config = readConfig()
  const initialized = config.initialized && isOpen()
  return {
    initialized,
    dataDir: config.dataDir,
    defaultDataDir: defaultDataDir(),
    dbPath: dbPath(config.dataDir),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    settings: initialized ? settingsRepo.getAll() : null
  }
}

export function registerAppIpc(): void {
  ipcMain.handle(IPC.appBootstrap, (): BootstrapInfo => bootstrapInfo())

  ipcMain.handle(
    IPC.appInitialize,
    (_event, payload: { currency: string; dataDir: string; seedMode?: 'template' | 'blank' }): BootstrapInfo => {
      ensureDir(payload.dataDir)
      writeConfig({ initialized: true, dataDir: payload.dataDir })
      const result = initDatabase(payload.dataDir, payload.seedMode === 'blank' ? 'blank' : 'template')
      if (result.integrityError) {
        throw new Error(`数据库完整性校验未通过：${result.integrityError}`)
      }
      settingsRepo.set('currency', payload.currency || 'CNY')
      return bootstrapInfo()
    }
  )

  ipcMain.handle(IPC.appChooseDataDir, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '选择数据存储位置',
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          title: '选择数据存储位置',
          properties: ['openDirectory', 'createDirectory']
        })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.appOpenDataDir, async (): Promise<void> => {
    await shell.openPath(getDataDir())
  })

  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    const file = dbPath(getDataDir())
    let size = 0
    try {
      size = statSync(file).size
    } catch {
      size = 0
    }
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      dbPath: file,
      dataDir: getDataDir(),
      dbSizeBytes: size
    }
  })

  ipcMain.handle(IPC.appBackup, (): BackupResult => backupNow())

  ipcMain.handle(IPC.appBackupInfo, (): BackupInfo => backupInfo())

  // 便携模式说明：设置页要告诉用户「数据跟着 exe 走」
  ipcMain.handle('app:portable-root', (): string | null => portableRoot())
}
