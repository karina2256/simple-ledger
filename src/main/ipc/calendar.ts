import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { expandOccurrences } from '@shared/recurring'
import type { CalendarSummary, RecurringOccurrence } from '@shared/types'
import * as recordsRepo from '../db/repositories/records.repo'
import * as recurringRepo from '../db/repositories/recurring.repo'
import { assertReady } from './guard'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** 一次最多取一年多的数据，防止界面传个离谱的区间把内存吃满 */
const MAX_SPAN_DAYS = 400

export function registerCalendarIpc(): void {
  ipcMain.handle(IPC.calendarSummary, (_event, range: { from: string; to: string }): CalendarSummary => {
    assertReady()
    const from = range?.from
    const to = range?.to
    if (!DATE_RE.test(from ?? '') || !DATE_RE.test(to ?? '')) throw new Error('日期区间不合法')
    if (to < from) throw new Error('结束日期早于开始日期')
    const span = (new Date(to).getTime() - new Date(from).getTime()) / 86400000
    if (span > MAX_SPAN_DAYS) throw new Error(`一次最多查询 ${MAX_SPAN_DAYS} 天`)

    const days = recordsRepo.dayTotals(from, to)

    // 周期记账只做标记，不生成记录；标记完全由 start_date + 频率推算
    const occurrences: RecurringOccurrence[] = []
    for (const rule of recurringRepo.list(true)) {
      for (const date of expandOccurrences(rule, from, to)) {
        occurrences.push({
          ruleId: rule.id,
          name: rule.name,
          date,
          amount: rule.amount,
          type: rule.type,
          accountId: rule.accountId,
          categoryId: rule.categoryId
        })
      }
    }

    return { range: { from, to }, days, occurrences }
  })
}
