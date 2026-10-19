import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { UpdateCheckResult, WriteResult } from '@shared/types'
import * as settingsRepo from '../db/repositories/settings.repo'
import { checkUpdate, hashPin, verifyPin } from '../services/security.service'
import { assertReady } from './guard'

/**
 * 应用锁与检查更新的 IPC。
 *
 * 哈希只在主进程算：渲染进程永远拿不到 PIN，也拿不到盐以外的信息。
 */
export function registerSecurityIpc(): void {
  ipcMain.handle(IPC.securitySetPin, (_event, pin: string): WriteResult => {
    assertReady()
    const text = String(pin ?? '').trim()
    if (text.length < 4) return { ok: false, message: 'PIN 至少 4 位' }
    if (text.length > 32) return { ok: false, message: 'PIN 太长了（最多 32 位）' }
    const { hash, salt } = hashPin(text)
    settingsRepo.setMany({ lockPinHash: hash, lockPinSalt: salt })
    return { ok: true }
  })

  ipcMain.handle(IPC.securityClearPin, (): WriteResult => {
    assertReady()
    settingsRepo.setMany({ lockPinHash: '', lockPinSalt: '' })
    return { ok: true }
  })

  ipcMain.handle(IPC.securityVerifyPin, (_event, pin: string): boolean => {
    assertReady()
    const settings = settingsRepo.getAll()
    return verifyPin(String(pin ?? ''), settings.lockPinHash, settings.lockPinSalt)
  })

  ipcMain.handle(IPC.appCheckUpdate, async (): Promise<UpdateCheckResult> => checkUpdate())
}
