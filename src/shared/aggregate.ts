/**
 * 汇总纯函数：四级日历视图共用一个口径。
 *
 * 所有数字都来自「按天聚合」的同一份数据，年 / 月 / 周只是把它滚起来，
 * 这样不会出现「月视图加起来对不上年视图」。
 * 转账不计入收入 / 支出（只单独统计），与已确认的口径一致。
 */
import type { CalendarDay, Totals } from './types'
import { addDays, eachDay } from './date'

export const EMPTY_TOTALS: Totals = { income: 0, expense: 0, transfer: 0, net: 0, count: 0 }

export function withNet(totals: Omit<Totals, 'net'>): Totals {
  return { ...totals, net: totals.income - totals.expense }
}

export function sumRange(days: CalendarDay[], from?: string, to?: string): Totals {
  const scoped = days.filter((day) => (!from || day.date >= from) && (!to || day.date <= to))
  const totals = scoped.reduce<Omit<Totals, 'net'>>(
    (acc, day) => ({
      income: acc.income + day.income,
      expense: acc.expense + day.expense,
      transfer: acc.transfer + day.transfer,
      count: acc.count + day.count
    }),
    { income: 0, expense: 0, transfer: 0, count: 0 }
  )
  return withNet(totals)
}

/** 年视图：12 个月，缺的补 0。用 'YYYY-MM-31' 当上界，字符串比较天然安全 */
export function sumByMonth(days: CalendarDay[], year: number): { month: number; key: string; totals: Totals }[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const key = `${year}-${String(month).padStart(2, '0')}`
    return { month, key, totals: sumRange(days, `${key}-01`, `${key}-31`) }
  })
}

/** 周视图：7 天，缺的补 0 */
export function sumByWeek(days: CalendarDay[], monday: string): { date: string; totals: Totals }[] {
  const map = new Map(days.map((day) => [day.date, day]))
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index)
    const day = map.get(date)
    return {
      date,
      totals: day
        ? withNet({ income: day.income, expense: day.expense, transfer: day.transfer, count: day.count })
        : { ...EMPTY_TOTALS }
    }
  })
}

/** 把按天聚合补齐成连续区间（缺的天补 0），日历格需要对每一天都有值 */
export function fillDays(days: CalendarDay[], from: string, to: string): CalendarDay[] {
  const map = new Map(days.map((day) => [day.date, day]))
  return eachDay(from, to).map((date) => map.get(date) ?? { date, income: 0, expense: 0, transfer: 0, count: 0 })
}
