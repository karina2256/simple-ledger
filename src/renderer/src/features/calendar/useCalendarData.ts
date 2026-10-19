import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CalendarDay, RecurringOccurrence, RecordListItem } from '@shared/types'
import { addDays, monthGridRange, startOfWeek } from '@shared/date'
import { toastError } from '../../stores/toast.store'

export type CalendarView = 'year' | 'month' | 'week' | 'day'

export interface CalendarData {
  range: { from: string; to: string }
  days: CalendarDay[]
  occurrences: RecurringOccurrence[]
  records: RecordListItem[]
  loading: boolean
  reload: () => Promise<void>
}

/** 各视图需要的数据区间 */
export function rangeOf(view: CalendarView, anchor: string): { from: string; to: string } {
  switch (view) {
    case 'year':
      return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` }
    case 'month':
      return monthGridRange(anchor)
    case 'week': {
      const from = startOfWeek(anchor)
      return { from, to: addDays(from, 6) }
    }
    case 'day':
    default:
      return { from: anchor, to: anchor }
  }
}

/**
 * 日历数据：一次 calendar:summary 拿到日聚合 + 周期发生点；
 * 周 / 日视图再补一次记录明细（复用记录列表接口）。
 */
export function useCalendarData(view: CalendarView, anchor: string): CalendarData {
  const range = useMemo(() => rangeOf(view, anchor), [view, anchor])
  const [days, setDays] = useState<CalendarDay[]>([])
  const [occurrences, setOccurrences] = useState<RecurringOccurrence[]>([])
  const [records, setRecords] = useState<RecordListItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const summary = await window.api.calendar.summary(range)
      setDays(summary.days)
      setOccurrences(summary.occurrences)
      if (view === 'week' || view === 'day') {
        const list = await window.api.records.list({ from: range.from, to: range.to, limit: 1000 })
        setRecords(list.items)
      } else {
        setRecords([])
      }
    } catch (error) {
      toastError(error)
    } finally {
      setLoading(false)
    }
  }, [range, view])

  useEffect(() => {
    void load()
  }, [load])

  return { range, days, occurrences, records, loading, reload: load }
}

/** 每天的周期发生点 */
export function groupOccurrences(occurrences: RecurringOccurrence[]): Map<string, RecurringOccurrence[]> {
  const map = new Map<string, RecurringOccurrence[]>()
  for (const item of occurrences) {
    const list = map.get(item.date)
    if (list) list.push(item)
    else map.set(item.date, [item])
  }
  return map
}

/** 按日期分桶的记录明细 */
export function groupRecords(records: RecordListItem[]): Map<string, RecordListItem[]> {
  const map = new Map<string, RecordListItem[]>()
  for (const item of records) {
    const list = map.get(item.date)
    if (list) list.push(item)
    else map.set(item.date, [item])
  }
  return map
}
