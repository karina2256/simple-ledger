import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings, SettingKey } from '@shared/types'
import * as settingsRepo from '../db/repositories/settings.repo'
import { assertReady } from './guard'

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settingsGet, (): AppSettings => {
    assertReady()
    return settingsRepo.getAll()
  })

  ipcMain.handle(IPC.settingsSet, (_event, key: SettingKey, value: unknown): AppSettings => {
    assertReady()
    return settingsRepo.set(key, value as AppSettings[SettingKey])
  })

  ipcMain.handle(IPC.settingsReset, (): AppSettings => {
    assertReady()
    return settingsRepo.reset()
  })
}
