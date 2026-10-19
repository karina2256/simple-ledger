import { useMemo } from 'react'
import { fillDays, sumByMonth, sumByWeek, sumRange } from '@shared/aggregate'
import {
  addDays,
  eachDay,
  formatFullCN,
  formatMonthDay,
  formatWeekday,
  isoWeekNumber,
  monthGridRange,
  startOfWeek
} from '@shared/date'
import type { Attachment, RecordListItem } from '@shared/types'
import { Icon } from '../../components/Icon'
import { RecordTable } from '../records/RecordTable'
import { RecurringBadge, RecurringRow, TotalsRows, money, signedMoney } from './parts'
import { groupOccurrences, groupRecords, type CalendarData, type CalendarView } from './useCalendarData'

export interface ViewProps {
  anchor: string
  data: CalendarData
  onNavigate: (view: CalendarView, date: string) => void
  onPickDate: (date: string) => void
  onEditRecord: (item: RecordListItem) => void
  onDeleteRecord: (item: RecordListItem) => void
  onPreview: (attachment: Attachment) => void
}

/** 年视图：12 个月格 */
export function YearView({ anchor, data, onNavigate }: ViewProps): JSX.Element {
  const year = Number(anchor.slice(0, 4))
  const months = useMemo(() => sumByMonth(data.days, year), [data.days, year])
  const occurrenceMonths = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of data.occurrences) {
      const key = item.date.slice(0, 7)
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [data.occurrences])

  const yearTotals = useMemo(() => sumRange(data.days), [data.days])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-6 px-1 text-sm">
        <span className="text-muted">全年</span>
        <span className="text-income">收入 {money(yearTotals.income)}</span>
        <span className="text-expense">支出 {money(yearTotals.expense)}</span>
        <span className={yearTotals.net >= 0 ? 'text-income' : 'text-expense'}>
          净变化 {signedMoney(yearTotals.net)}
        </span>
        <span className="text-muted">{yearTotals.count} 笔</span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {months.map(({ month, key, totals }) => {
          const count = occurrenceMonths.get(key) ?? 0
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate('month', `${key}-01`)}
              className="text-left bg-card border border-line rounded-card p-3 hover:border-accent transition"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{month} 月</span>
                {count > 0 ? <RecurringBadge occurrences={data.occurrences.filter((o) => o.date.startsWith(key))} /> : null}
              </div>
              <TotalsRows totals={totals} showZero size="md" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 月视图：日历格 + 周序号列 */
export function MonthView({ anchor, data, onNavigate, onPickDate }: ViewProps): JSX.Element {
  const { from, to } = useMemo(() => monthGridRange(anchor), [anchor])
  const grid = useMemo(() => fillDays(data.days, from, to), [data.days, from, to])
  const dayMap = useMemo(() => new Map(grid.map((day) => [day.date, day])), [grid])
  const occurrenceMap = useMemo(() => groupOccurrences(data.occurrences), [data.occurrences])
  const currentMonth = anchor.slice(0, 7)

  const weekStarts: string[] = []
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 7)) weekStarts.push(cursor)

  const monthTotals = useMemo(() => sumRange(data.days, `${currentMonth}-01`, `${currentMonth}-31`), [data.days, currentMonth])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-6 px-1 text-sm">
        <span className="text-muted">本月</span>
        <span className="text-income">收入 {money(monthTotals.income)}</span>
        <span className="text-expense">支出 {money(monthTotals.expense)}</span>
        <span className={monthTotals.net >= 0 ? 'text-income' : 'text-expense'}>
          净变化 {signedMoney(monthTotals.net)}
        </span>
      </div>

      <div className="bg-card border border-line rounded-card overflow-hidden">
        <div className="grid grid-cols-[64px_repeat(7,1fr)] border-b border-line text-xs text-muted">
          <div className="h-9 flex items-center justify-center">周</div>
          {['一', '二', '三', '四', '五', '六', '日'].map((label) => (
            <div key={label} className="h-9 flex items-center justify-center">
              {label}
            </div>
          ))}
        </div>

        {weekStarts.map((weekStart) => (
          <div key={weekStart} className="grid grid-cols-[64px_repeat(7,1fr)] border-b border-line last:border-0">
            <button
              type="button"
              onClick={() => onNavigate('week', weekStart)}
              className="flex items-center justify-center text-xs text-muted hover:text-accent border-r border-line"
              title="打开这一周"
            >
              第 {isoWeekNumber(weekStart)} 周
            </button>
            {eachDay(weekStart, addDays(weekStart, 6)).map((date) => {
              const day = dayMap.get(date)
              const totals = day
                ? { income: day.income, expense: day.expense, transfer: day.transfer, net: day.income - day.expense, count: day.count }
                : { income: 0, expense: 0, transfer: 0, net: 0, count: 0 }
              const outside = date.slice(0, 7) !== currentMonth
              const occurrences = occurrenceMap.get(date) ?? []
              return (
                <div
                  key={date}
                  className={`group relative min-h-[86px] p-2 border-r border-line last:border-r-0 ${
                    outside ? 'bg-soft/40' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <button
                      type="button"
                      onClick={() => onNavigate('day', date)}
                      className={`text-xs w-6 h-6 rounded-md hover:bg-soft ${outside ? 'text-muted' : 'text-main'}`}
                    >
                      {Number(date.slice(8, 10))}
                    </button>
                    <div className="flex items-center gap-1">
                      <RecurringBadge occurrences={occurrences} />
                      <button
                        type="button"
                        onClick={() => onPickDate(date)}
                        title={`在 ${date} 记一笔`}
                        className={`w-5 h-5 rounded text-xs leading-none opacity-0 group-hover:opacity-100 transition ${
                          outside ? 'text-muted hover:text-accent' : 'text-muted hover:text-accent'
                        }`}
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                  <button type="button" onClick={() => onNavigate('day', date)} className="block w-full text-left">
                    <TotalsRows totals={totals} />
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** 周视图：7 天列 */
export function WeekView({ anchor, data, onNavigate, onPickDate }: ViewProps): JSX.Element {
  const monday = startOfWeek(anchor)
  const columns = useMemo(() => sumByWeek(data.days, monday), [data.days, monday])
  const recordMap = useMemo(() => groupRecords(data.records), [data.records])
  const occurrenceMap = useMemo(() => groupOccurrences(data.occurrences), [data.occurrences])
  const weekTotals = useMemo(() => sumRange(data.days, monday, addDays(monday, 6)), [data.days, monday])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-6 px-1 text-sm">
        <span className="text-muted">本周</span>
        <span className="text-income">收入 {money(weekTotals.income)}</span>
        <span className="text-expense">支出 {money(weekTotals.expense)}</span>
        <span className={weekTotals.net >= 0 ? 'text-income' : 'text-expense'}>
          净变化 {signedMoney(weekTotals.net)}
        </span>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {columns.map(({ date, totals }) => {
          const items = recordMap.get(date) ?? []
          const occurrences = occurrenceMap.get(date) ?? []
          const shown = items.slice(0, 6)
          return (
            <div key={date} className="bg-card border border-line rounded-card overflow-hidden flex flex-col">
              <div className="px-2 py-2 border-b border-line">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onNavigate('day', date)}
                    className="text-xs text-main hover:text-accent"
                  >
                    {formatMonthDay(date)} {formatWeekday(date)}
                  </button>
                  <button
                    type="button"
                    onClick={() => onPickDate(date)}
                    title={`在 ${date} 记一笔`}
                    className="w-5 h-5 rounded text-xs text-muted hover:text-accent"
                  >
                    ＋
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <RecurringBadge occurrences={occurrences} />
                </div>
              </div>

              <div className="px-2 py-2 border-b border-line bg-soft/40">
                <TotalsRows totals={totals} showZero />
              </div>

              <div className="p-1.5 space-y-1 flex-1">
                {occurrences.map((item) => (
                  <RecurringRow key={`${item.ruleId}-${item.date}`} occurrence={item} />
                ))}
                {shown.map((item) => (
                  <div key={item.id} className="flex items-center gap-1 text-[11px] px-1">
                    <span className="truncate text-muted">{item.note || item.categoryName || '—'}</span>
                    <span className={`ml-auto tabular-nums ${item.type === 'income' ? 'text-income' : item.type === 'expense' ? 'text-expense' : 'text-muted'}`}>
                      {item.type === 'income' ? '+' : item.type === 'expense' ? '−' : ''}
                      {money(item.amount)}
                    </span>
                  </div>
                ))}
                {items.length > shown.length ? (
                  <button
                    type="button"
                    onClick={() => onNavigate('day', date)}
                    className="w-full text-left text-[11px] text-accent hover:underline px-1"
                  >
                    还有 {items.length - shown.length} 笔…
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 日视图：当天全部记录 */
export function DayView({ anchor, data, onPickDate, onEditRecord, onDeleteRecord, onPreview }: ViewProps): JSX.Element {
  const totals = useMemo(() => sumRange(data.days, anchor, anchor), [data.days, anchor])
  const occurrences = useMemo(
    () => data.occurrences.filter((item) => item.date === anchor),
    [data.occurrences, anchor]
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-5 text-sm">
          <span className="text-main">{formatFullCN(anchor)}</span>
          <span className="text-income">收入 {money(totals.income)}</span>
          <span className="text-expense">支出 {money(totals.expense)}</span>
          <span className={totals.net >= 0 ? 'text-income' : 'text-expense'}>
            净变化 {signedMoney(totals.net)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onPickDate(anchor)}
          className="h-9 px-3 rounded-lg bg-accent text-white text-sm hover:opacity-90"
        >
          <Icon name="plus" size={16} /> 记一笔
        </button>
      </div>

      {occurrences.length > 0 ? (
        <div className="bg-card border border-line rounded-card p-3 space-y-2">
          <div className="text-xs text-muted">周期记账（仅标记，未生成记录）</div>
          {occurrences.map((item) => (
            <RecurringRow key={`${item.ruleId}-${item.date}`} occurrence={item} />
          ))}
        </div>
      ) : null}

      <div className="bg-card border border-line rounded-card overflow-hidden">
        <RecordTable
          items={data.records}
          loading={data.loading}
          showDate={false}
          emptyText="这一天还没有记录"
          emptyHint="点右上角「记一笔」补上"
          onEdit={onEditRecord}
          onDelete={onDeleteRecord}
          onPreview={onPreview}
        />
      </div>

      {totals.transfer > 0 ? (
        <p className="text-xs text-muted">
          另有转账 {money(totals.transfer)}（不计入收支）
        </p>
      ) : null}
    </div>
  )
}
