import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { StatsSummary } from '@shared/types'
import * as statsRepo from '../db/repositories/stats.repo'
import { assertReady } from './guard'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_SPAN_DAYS = 800

export function registerStatsIpc(): void {
  ipcMain.handle(IPC.statsSummary, (_event, range: { from: string; to: string }): StatsSummary => {
    assertReady()
    const from = range?.from
    const to = range?.to
    if (!DATE_RE.test(from ?? '') || !DATE_RE.test(to ?? '')) throw new Error('日期区间不合法')
    if (to < from) throw new Error('结束日期早于开始日期')
    const span = (new Date(to).getTime() - new Date(from).getTime()) / 86400000
    if (span > MAX_SPAN_DAYS) throw new Error(`一次最多统计 ${MAX_SPAN_DAYS} 天`)

    const summary = statsRepo.summary(from, to)
    // 「未分类」也作为一档显示，否则饼图加起来对不上总额，用户会以为算错了
    const uncategorized = statsRepo.uncategorizedTotal(from, to)
    if (uncategorized > 0 && !summary.byCategory.some((item) => item.categoryId === null)) {
      summary.byCategory.push({
        categoryId: null,
        name: '未分类',
        icon: 'inbox',
        color: '#8A9BA8',
        type: 'expense',
        total: uncategorized,
        count: 0
      })
    }
    return summary
  })
}
