import type { AppSettings, SettingKey } from '@shared/types'
import { getAll, set } from './db/repositories/settings.repo'

let cached: AppSettings | null = null

export function getSettings(): AppSettings {
  if (!cached) cached = getAll()
  return cached
}

/** 任何写设置的地方都要过这里，保证缓存与库一致 */
export function setSetting<K extends SettingKey>(key: K, value: AppSettings[K]): AppSettings {
  cached = set(key, value)
  return cached
}

/**
 * 启动时把某些设置临时压过去，只改内存里的缓存，不写库。
 * 目前用在动效验证上——探针需要强制某一档动效，又不想污染用户设置。
 */
export function applySettingOverrides(): void {
  const forced = process.env['LEDGER_FORCE_MOTION']
  if (forced === 'showcase' || forced === 'standard' || forced === 'minimal') {
    cached = { ...getSettings(), motion: forced }
    console.log(`[settings] 本次运行强制动效档位 = ${forced}（未写入数据库）`)
  }
}

/** 数据目录变化 / 重新初始化时调用 */
export function resetSettingsCache(): void {
  cached = null
}
