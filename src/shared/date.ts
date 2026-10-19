/**
 * 日期工具：全程使用 YYYY-MM-DD 字符串，内部用本地时间构造 Date，
 * 绝不走 new Date('YYYY-MM-DD')（那是按 UTC 解析的，会跨时区漂移）。
 */

export const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'] as const

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function parseKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

export function todayKey(): string {
  return dateKey(new Date())
}

export function addDays(key: string, days: number): string {
  const date = parseKey(key)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

/** 加月份：目标月没有该日时取当月最后一天（1/31 + 1 月 = 2/28） */
export function addMonths(key: string, months: number): string {
  const [year, month, day] = key.split('-').map(Number)
  const first = new Date(year, month - 1 + months, 1)
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return dateKey(new Date(first.getFullYear(), first.getMonth(), Math.min(day, lastDay)))
}

/** 加年份：2/29 在平年落到 2/28 */
export function addYears(key: string, years: number): string {
  return addMonths(key, years * 12)
}

/** 周一为一周的第一天 */
export function startOfWeek(key: string): string {
  const date = parseKey(key)
  const weekday = date.getDay() // 0 = 周日
  const offset = weekday === 0 ? -6 : 1 - weekday
  date.setDate(date.getDate() + offset)
  return dateKey(date)
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`
}

export function endOfMonth(key: string): string {
  const [year, month] = key.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return `${key.slice(0, 7)}-${pad2(lastDay)}`
}

export function monthKey(key: string): string {
  return key.slice(0, 7)
}

export function startOfYear(key: string): string {
  return `${key.slice(0, 4)}-01-01`
}

export function endOfYear(key: string): string {
  return `${key.slice(0, 4)}-12-31`
}

/** 月视图的日历格范围：补齐首尾两周里属于上/下月的日期 */
export function monthGridRange(anchor: string): { from: string; to: string } {
  const from = startOfWeek(startOfMonth(anchor))
  const lastWeekStart = startOfWeek(endOfMonth(anchor))
  return { from, to: addDays(lastWeekStart, 6) }
}

/** ISO 周序号（周一为一周起点） */
export function isoWeekNumber(key: string): number {
  const date = parseKey(startOfWeek(key))
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 3)
  const firstThursday = new Date(thursday.getFullYear(), 0, 4)
  const firstThursdayMonday = parseKey(startOfWeek(dateKey(firstThursday)))
  const diffDays = Math.round((thursday.getTime() - firstThursdayMonday.getTime()) / 86400000)
  return Math.floor(diffDays / 7) + 1
}

export function weekdayIndex(key: string): number {
  return parseKey(key).getDay()
}

export function formatMonthDay(key: string): string {
  const [, month, day] = key.split('-').map(Number)
  return `${month}月${day}日`
}

export function formatWeekday(key: string): string {
  return `周${WEEKDAY_CN[weekdayIndex(key)]}`
}

/** 2025年6月18日 周三 */
export function formatFullCN(key: string): string {
  const [year] = key.split('-').map(Number)
  return `${year}年${formatMonthDay(key)} ${formatWeekday(key)}`
}

export function eachDay(from: string, to: string): string[] {
  const result: string[] = []
  let cursor = from
  let guard = 0
  while (cursor <= to && guard < 4000) {
    result.push(cursor)
    cursor = addDays(cursor, 1)
    guard += 1
  }
  return result
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseKey(to).getTime() - parseKey(from).getTime()) / 86400000)
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

export function clampKey(key: string, min: string, max: string): string {
  if (key < min) return min
  if (key > max) return max
  return key
}
