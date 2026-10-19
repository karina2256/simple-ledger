/** 金额工具：数据库一律存「分」，这是唯一的换算与格式化出口 */

export function yuanToCents(yuan: number): number {
  return Math.round(yuan * 100)
}

export function centsToYuan(cents: number): number {
  return cents / 100
}

/** 解析用户输入的金额字符串 → 分。非法返回 null */
export function parseAmountToCents(input: string): number | null {
  const text = input.trim().replace(/[，,\s￥¥$]/g, '')
  if (!text) return null
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return null
  const cents = Math.round(Number(text) * 100)
  if (!Number.isFinite(cents) || cents < 0) return null
  return cents
}

/** 分 → 元字符串，固定两位小数，带千分位 */
export function formatCents(cents: number, withGrouping = true): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const yuan = Math.floor(abs / 100)
  const rest = String(abs % 100).padStart(2, '0')
  const head = withGrouping ? yuan.toLocaleString('en-US') : String(yuan)
  return `${negative ? '-' : ''}${head}.${rest}`
}

export interface MoneyDisplay {
  primary: string
  secondary: string | null
}

/**
 * 金额显示：主币种人民币；开启美元后同时显示 USD（按手动填写的汇率换算）。
 */
export function formatMoney(
  cents: number,
  opts: { currency?: string; showUsd?: boolean; usdRate?: number; signed?: boolean; type?: string }
): MoneyDisplay {
  const { currency = 'CNY', showUsd = false, usdRate = 7.2, signed = false, type } = opts
  const sign = signed && type === 'income' ? '+' : signed && type === 'expense' ? '-' : ''
  const symbol = currency === 'CNY' ? '¥' : '$'
  const primary = `${sign}${symbol}${formatCents(Math.abs(cents))}`
  if (!showUsd || currency !== 'CNY') return { primary, secondary: null }
  const rate = usdRate > 0 ? usdRate : 7.2
  // 分(CNY) / 汇率 = 分(USD)
  const usdCents = Math.round(Math.abs(cents) / rate)
  return { primary, secondary: `≈ $${formatCents(usdCents)}` }
}
