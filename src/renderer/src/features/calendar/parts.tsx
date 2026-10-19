import { formatCents } from '@shared/money'
import type { RecurringOccurrence, Totals } from '@shared/types'

export function money(cents: number): string {
  return `¥${formatCents(Math.abs(cents))}`
}

export function signedMoney(cents: number): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : ''
  return `${sign}¥${formatCents(Math.abs(cents))}`
}

/**
 * 收入 / 支出 / 净变化三行。
 * 三色语义固定：收入绿、支出红、净变化正绿负红零弱化；符号始终显式写出，不靠颜色单独表意。
 */
export function TotalsRows({
  totals,
  showZero = false,
  size = 'sm'
}: {
  totals: Totals
  showZero?: boolean
  size?: 'sm' | 'md'
}): JSX.Element {
  const textSize = size === 'md' ? 'text-sm' : 'text-[11px] leading-4'
  const has = totals.income !== 0 || totals.expense !== 0
  if (!has && !showZero) return <span className={`${textSize} text-muted`}>—</span>
  return (
    <div className={`flex flex-col ${textSize} tabular-nums`}>
      {(totals.income !== 0 || showZero) && (
        <span className="text-income">
          <span className="text-muted">收 </span>
          {signedMoney(totals.income)}
        </span>
      )}
      {(totals.expense !== 0 || showZero) && (
        <span className="text-expense">
          <span className="text-muted">支 </span>
          {signedMoney(-totals.expense)}
        </span>
      )}
      {(has || showZero) && (
        <span className={totals.net > 0 ? 'text-income' : totals.net < 0 ? 'text-expense' : 'text-muted'}>
          <span className="text-muted">净 </span>
          {signedMoney(totals.net)}
        </span>
      )}
    </div>
  )
}

/** 周期记账标记：只表示「这天／这个月有周期规则」，不生成记录 */
export function RecurringBadge({
  occurrences,
  className = ''
}: {
  occurrences: RecurringOccurrence[]
  className?: string
}): JSX.Element | null {
  if (occurrences.length === 0) return null
  const title = occurrences
    .map((item) => `${item.name} ${item.type === 'income' ? '+' : '−'}${money(item.amount)}`)
    .join('\n')
  return (
    <span
      title={`周期记账（仅标记，未生成记录）\n${title}`}
      className={`inline-flex items-center justify-center text-[10px] leading-none rounded px-1 py-0.5 bg-accent-soft text-accent cursor-help ${className}`}
    >
      ⟳{occurrences.length > 1 ? occurrences.length : ''}
    </span>
  )
}

/** 日视图 / 周视图列里的周期条目：虚线框，明确标注不是真实记录 */
export function RecurringRow({ occurrence }: { occurrence: RecurringOccurrence }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-dashed border-accent/60 px-1.5 py-1 text-[11px] text-muted">
      <span className="text-accent">⟳</span>
      <span className="truncate">{occurrence.name}</span>
      <span className={`ml-auto tabular-nums ${occurrence.type === 'income' ? 'text-income' : 'text-expense'}`}>
        {occurrence.type === 'income' ? '+' : '−'}
        {money(occurrence.amount)}
      </span>
    </div>
  )
}
