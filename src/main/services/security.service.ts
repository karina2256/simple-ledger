import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { UpdateCheckResult } from '@shared/types'
import { app } from 'electron'

/**
 * 应用锁与「检查更新」。
 *
 * 关于应用锁的诚实说明：
 *   PIN 用 scrypt 加盐哈希后存进 settings 表，**和数据库是同一个文件**。
 *   它的作用是「别人随手打开你的电脑时看不到账目」，不是「把 .db 拷走也读不出」。
 *   要做到后者必须换 SQLCipher 加密整库（需要迁移，且要你确认）。
 */

const KEY_LEN = 32

/** 生成盐 + 哈希。格式固定，方便以后换算法时识别 */
export function hashPin(pin: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pin, salt, KEY_LEN).toString('hex')
  return { hash, salt }
}

/** 校验 PIN：用同一个盐重算再定时安全比较，避免长度泄露 */
export function verifyPin(pin: string, hash: string, salt: string): boolean {
  if (!hash || !salt) return false
  try {
    const candidate = scryptSync(pin, salt, KEY_LEN)
    const expected = Buffer.from(hash, 'hex')
    if (candidate.length !== expected.length) return false
    return timingSafeEqual(candidate, expected)
  } catch {
    return false
  }
}

/** 版本比较：只比较数字段，忽略 v 前缀与 -beta 这类后缀 */
export function compareVersion(a: string, b: string): number {
  const clean = (value: string): number[] =>
    value
      .replace(/^v/i, '')
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10))
      .map((num) => (Number.isFinite(num) ? num : 0))
  const left = clean(a)
  const right = clean(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

interface UpdateManifest {
  version?: string
  url?: string
  notes?: string
}

/**
 * 检查更新：读一个静态 JSON 清单，形如
 *   { "version": "1.1.0", "url": "https://你的站点/download", "notes": "修了 XX" }
 *
 * 为什么不做「静默自动升级」：Windows 上静默安装要求代码签名，
 * 而且离线记账工具突然自己换版本会让用户不安。这里是「告诉你有没有新版 + 给个链接」。
 * 地址来源：环境变量 LEDGER_UPDATE_URL 优先，否则用打包时写入的常量（没配就返回未配置）。
 */
const DEFAULT_UPDATE_URL = ''

export async function checkUpdate(): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  const url = process.env['LEDGER_UPDATE_URL'] || DEFAULT_UPDATE_URL
  if (!url) {
    return {
      ok: false,
      current,
      latest: null,
      hasUpdate: false,
      url: null,
      notes: null,
      message: '还没有配置更新清单地址（设置环境变量 LEDGER_UPDATE_URL，或把它写进代码里的常量）'
    }
  }

  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const manifest = (await response.json()) as UpdateManifest
    const latest = manifest.version ?? null
    if (!latest) throw new Error('清单里没有 version 字段')
    return {
      ok: true,
      current,
      latest,
      hasUpdate: compareVersion(latest, current) > 0,
      url: manifest.url ?? null,
      notes: manifest.notes ?? null
    }
  } catch (error) {
    return {
      ok: false,
      current,
      latest: null,
      hasUpdate: false,
      url: null,
      notes: null,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
