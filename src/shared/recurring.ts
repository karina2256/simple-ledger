/**
 * 周期记账规则的发生点展开。
 *
 * 口径：
 *  - 第 k 次发生（k ≥ 0）从 start_date 直接推算，不依赖上一次的结果，
 *    所以「1 月 31 日」的月租在 2 月落 2/28、3 月仍然回到 3/31。
 *  - end_date 为空表示长期有效。
 *  - next_date 只是缓存，供列表显示「下次记账」，**不参与**发生点计算——
 *    否则它一旦过期，标记就会悄悄消失。
 */
import type { Frequency } from './types'
import { addDays, addMonths, daysBetween, monthsBetween } from './date'

/** 单条规则在 [from, to] 内的发生日期（升序） */
export function expandOccurrences(
  rule: { frequency: Frequency; interval: number; startDate: string; endDate: string | null },
  from: string,
  to: string
): string[] {
  const interval = Math.max(1, Math.floor(rule.interval || 1))
  const start = rule.startDate
  const hardEnd = rule.endDate && rule.endDate < to ? rule.endDate : to
  if (hardEnd < start || to < start) return []

  // 估算起始 k，避免「2015 年开始的日租」在 2025 年要空转几千次
  let startIndex = 0
  if (from > start) {
    const diff =
      rule.frequency === 'daily'
        ? daysBetween(start, from)
        : rule.frequency === 'weekly'
          ? Math.floor(daysBetween(start, from) / 7)
          : rule.frequency === 'monthly'
            ? monthsBetween(start, from)
            : Math.floor(monthsBetween(start, from) / 12)
    startIndex = Math.max(0, Math.floor(diff / interval) - 1)
  }

  const result: string[] = []
  for (let k = startIndex; k < startIndex + 5000; k += 1) {
    const date = occurrenceAt(rule.frequency, start, interval, k)
    if (date > hardEnd) break
    if (date >= from && date >= start) result.push(date)
  }
  return result
}

/** 第 k 次发生日 */
export function occurrenceAt(frequency: Frequency, startDate: string, interval: number, k: number): string {
  switch (frequency) {
    case 'daily':
      return addDays(startDate, k * interval)
    case 'weekly':
      return addDays(startDate, k * interval * 7)
    case 'monthly':
      return addMonths(startDate, k * interval)
    case 'yearly':
      return addMonths(startDate, k * interval * 12)
    default:
      return addDays(startDate, k * interval)
  }
}

/** 从某个日期（含）开始的下一次发生日，用于列表里的「下次记账」 */
export function nextOccurrence(rule: RuleLike, fromDate: string): string | null {
  if (!rule.enabled) return null
  const upper = addMonths(fromDate, 60)
  const list = expandOccurrences(rule, fromDate, upper)
  return list.length > 0 ? list[0] : null
}

interface RuleLike {
  frequency: Frequency
  interval: number
  startDate: string
  endDate: string | null
  enabled: boolean
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年'
}

/** 「每 2 个月」这样的中文描述 */
export function describeFrequency(frequency: Frequency, interval: number): string {
  const step = Math.max(1, Math.floor(interval || 1))
  if (step === 1) return FREQUENCY_LABEL[frequency]
  const unit = frequency === 'daily' ? '天' : frequency === 'weekly' ? '周' : frequency === 'monthly' ? '个月' : '年'
  return `每 ${step} ${unit}`
}
