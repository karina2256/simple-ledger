import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

// 按需注册：全量 import 'echarts' 会把渲染层包从 450KB 抬到 3MB
// （实测未注册的图表实现确实不再进包，sunburst/sankey 等只剩 aria 文案表）。
// 现在装的是折线 + 饼图 + 网格/提示/图例 + Canvas 渲染器，整包约 1.8MB——剩下的是图表本身的真实成本。
echarts.use([LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])
import {
  addMonths,
  daysBetween,
  endOfMonth,
  endOfYear,
  pad2,
  startOfMonth,
  startOfYear,
  todayKey
} from '@shared/date'
import { formatCents } from '@shared/money'
import type { CategoryTotal, StatsSummary } from '@shared/types'
import { Card, Empty, Hint, Segmented, Spinner } from '../../components/ui'
import { Icon } from '../../components/Icon'
import type { IconName } from '../../components/Icon'
import { MoneyText } from '../../components/MoneyText'
import { useAppStore } from '../../stores/app.store'
import { toastError } from '../../stores/toast.store'
import { riseStyle } from '../../motion'

/**
 * 「汇总」页：区间合计 + 年度月度趋势 + 收支构成 + 单笔极值。
 *
 * 口径说明（与后端一致）：转账不计入收支；分类金额按一级分类聚合。
 * 后端 monthly 只有「有数据的月份」，缺的月份由本页补 0 成完整 12 个月。
 */

type RangeKey = 'month' | 'recent3' | 'year' | 'all'

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: 'month', label: '本月' },
  { value: 'recent3', label: '近 3 个月' },
  { value: 'year', label: '今年' },
  { value: 'all', label: '全部' }
]

/** ECharts 读不到 CSS 变量，深浅两套色值在这里显式给出（与 styles/index.css 的 --c-* 对齐） */
interface Palette {
  text: string
  muted: string
  line: string
  card: string
  income: string
  expense: string
}

const LIGHT: Palette = {
  text: '#1f2a33',
  muted: '#5f6e7c',
  line: '#e2e8ee',
  card: '#ffffff',
  income: '#1f7a4d',
  expense: '#b23f38'
}

const DARK: Palette = {
  text: '#e5eaef',
  muted: '#93a1ae',
  line: '#2b343d',
  card: '#1b2128',
  income: '#6fcf9a',
  expense: '#f0908a'
}

interface MonthlyPoint {
  month: string
  income: number
  expense: number
}

interface PieSlice {
  name: string
  value: number
  count: number
  color: string
}

/** 「其他」合并项的固定灰蓝色 */
const OTHER_COLOR = '#8A9BA8'

/** 档位 → 查询区间（都是闭区间，含首尾两天） */
function rangeOf(key: RangeKey): { from: string; to: string } {
  const today = todayKey()
  if (key === 'month') return { from: startOfMonth(today), to: endOfMonth(today) }
  if (key === 'recent3') return { from: startOfMonth(addMonths(today, -3)), to: today }
  if (key === 'year') return { from: startOfYear(today), to: endOfYear(today) }
  // 「全部」没有真实的起点，用一个足够早的日期兜底（库里不可能有 2000 年之前的记录）
  return { from: '2000-01-01', to: today }
}

/** 把后端返回的「只有有数据的月份」补成完整 12 个月 */
function monthlySeries(rows: MonthlyPoint[], year: string): MonthlyPoint[] {
  const points: MonthlyPoint[] = []
  for (let index = 1; index <= 12; index += 1) {
    points.push({ month: `${year}-${pad2(index)}`, income: 0, expense: 0 })
  }
  for (const row of rows) {
    const slot = points.find((item) => item.month === row.month)
    if (!slot) continue
    slot.income += row.income
    slot.expense += row.expense
  }
  // 只看当年时，把「还没到的月份」裁掉：否则折线会从 9 月一路砸到 12 月的 0，
  // 看起来像账目断崖，其实是未来月份没数据。
  const now = new Date()
  if (Number(year) === now.getFullYear()) return points.slice(0, now.getMonth() + 1)
  return points
}

/** 按 type 拆分收支构成：降序取前 8 项，其余合并成「其他」 */
function pieSlices(rows: CategoryTotal[], type: 'income' | 'expense'): PieSlice[] {
  const sorted = rows
    .filter((row) => row.type === type && row.total > 0)
    .sort((a, b) => b.total - a.total)
  const head: PieSlice[] = sorted.slice(0, 8).map((row) => ({
    name: row.name,
    value: row.total,
    count: row.count,
    color: row.color
  }))
  const tail = sorted.slice(8)
  if (tail.length > 0) {
    head.push({
      name: '其他',
      value: tail.reduce((sum, row) => sum + row.total, 0),
      count: tail.reduce((sum, row) => sum + row.count, 0),
      color: OTHER_COLOR
    })
  }
  return head
}

function trendOption(points: MonthlyPoint[], palette: Palette): Record<string, unknown> {
  return {
    grid: { left: 4, right: 12, top: 34, bottom: 2, containLabel: true },
    legend: {
      top: 0,
      right: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
      textStyle: { color: palette.muted, fontSize: 12 }
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: palette.card,
      borderColor: palette.line,
      borderWidth: 1,
      textStyle: { color: palette.text, fontSize: 12 },
      valueFormatter: (value: number) => `¥${formatCents(Number(value))}`
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map((item) => `${Number(item.month.slice(5))}月`),
      axisLine: { lineStyle: { color: palette.line } },
      axisTick: { show: false },
      axisLabel: { color: palette.muted, fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: palette.line, type: 'dashed' } },
      axisLabel: {
        color: palette.muted,
        fontSize: 11,
        // 数值是「分」，刻度换算成元；上万再压成 k，避免轴标签挤在一起
        formatter: (value: number) =>
          Math.abs(value) >= 10000000 ? `${Math.round(value / 1000000) / 10}万` : String(Math.round(value / 100))
      }
    },
    series: [
      {
        name: '收入',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        data: points.map((item) => item.income),
        itemStyle: { color: palette.income },
        lineStyle: { width: 2, color: palette.income },
        areaStyle: { color: palette.income, opacity: 0.08 }
      },
      {
        name: '支出',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        data: points.map((item) => item.expense),
        itemStyle: { color: palette.expense },
        lineStyle: { width: 2, color: palette.expense },
        areaStyle: { color: palette.expense, opacity: 0.08 }
      }
    ]
  }
}

function pieOption(slices: PieSlice[], palette: Palette): Record<string, unknown> {
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: palette.card,
      borderColor: palette.line,
      borderWidth: 1,
      textStyle: { color: palette.text, fontSize: 12 },
      formatter: (params: { name: string; value: number; percent: number }) =>
        `${params.name}<br/>¥${formatCents(params.value)}（${params.percent}%）`
    },
    series: [
      {
        type: 'pie',
        radius: ['44%', '68%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        minShowLabelAngle: 6,
        itemStyle: { borderColor: palette.card, borderWidth: 2 },
        label: { color: palette.text, fontSize: 11, formatter: '{b} {d}%' },
        labelLine: { length: 8, length2: 8, lineStyle: { color: palette.line } },
        data: slices.map((slice) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: { color: slice.color }
        }))
      }
    ]
  }
}

function StatCard({
  label,
  icon,
  index,
  children
}: {
  label: string
  icon: IconName
  index: number
  children: ReactNode
}): JSX.Element {
  return (
    <Card className="m-rise cinema-reveal" style={riseStyle(index)}>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Icon name={icon} size={16} />
        {label}
      </div>
      <div className="mt-2 leading-none">{children}</div>
    </Card>
  )
}

export function StatsPage(): JSX.Element {
  const theme = useAppStore((state) => state.settings.theme)

  const [rangeKey, setRangeKey] = useState<RangeKey>('month')
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [trend, setTrend] = useState<StatsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const range = useMemo(() => rangeOf(rangeKey), [rangeKey])

  // 趋势图固定画「整年 12 个月」，年份跟随所选区间的起始年；
  // 「全部」没有单一自然年，退回当前年（标题里写明了是哪一年）。
  const trendYear = rangeKey === 'all' ? todayKey().slice(0, 4) : range.from.slice(0, 4)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      window.api.stats.summary(range),
      // 趋势图要的是整年序列，区间合计那一份可能是半个月 / 跨年，所以单独取一次
      window.api.stats.summary({
        from: startOfYear(`${trendYear}-01-01`),
        to: endOfYear(`${trendYear}-01-01`)
      })
    ])
      .then(([next, nextTrend]) => {
        if (!alive) return
        setSummary(next)
        setTrend(nextTrend)
        setFailed(false)
      })
      .catch((error: unknown) => {
        if (!alive) return
        setSummary(null)
        setTrend(null)
        setFailed(true)
        toastError(error)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [range, trendYear])

  const palette = theme === 'dark' ? DARK : LIGHT

  const monthly = useMemo(() => monthlySeries(trend?.monthly ?? [], trendYear), [trend, trendYear])
  const expenseSlices = useMemo(() => pieSlices(summary?.byCategory ?? [], 'expense'), [summary])
  const incomeSlices = useMemo(() => pieSlices(summary?.byCategory ?? [], 'income'), [summary])

  const trendChart = useMemo(() => trendOption(monthly, palette), [monthly, palette])
  const expenseChart = useMemo(() => pieOption(expenseSlices, palette), [expenseSlices, palette])
  const incomeChart = useMemo(() => pieOption(incomeSlices, palette), [incomeSlices, palette])

  // 「全部」跨度过大，日均没有意义
  const days = rangeKey === 'all' ? null : Math.max(1, daysBetween(range.from, range.to) + 1)
  const dailyExpense =
    days === null || !summary ? null : Math.round(summary.expense / days)

  const blank = (summary?.income ?? 0) === 0 && (summary?.expense ?? 0) === 0

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <Icon name="stats" size={20} className="text-accent" />
          <h1 className="cinema-page-title cinema-title text-xl font-medium">汇总</h1>
        </div>
        <Segmented value={rangeKey} options={RANGE_OPTIONS} onChange={setRangeKey} />
      </div>

      {loading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Spinner />
            正在统计…
          </div>
        </Card>
      ) : failed || !summary ? (
        <Card>
          <Empty text="统计失败" hint="换个时间范围再试一次" />
        </Card>
      ) : blank ? (
        <Card>
          <Empty text="这段时间还没有记录" hint="换个时间范围试试" />
        </Card>
      ) : (
        <div className="space-y-4">
          <Hint>
            统计区间 {range.from} ~ {range.to}
            {days === null ? '（全部记录）' : `（共 ${days} 天）`}，转账不计入收支。
          </Hint>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="收入" icon="chartUp" index={0}>
              <MoneyText cents={summary.income} type="income" strong className="text-lg" countUp />
            </StatCard>
            <StatCard label="支出" icon="receipt" index={1}>
              <MoneyText cents={summary.expense} type="expense" strong className="text-lg" countUp />
            </StatCard>
            <StatCard label="结余" icon="coins" index={2}>
              <MoneyText
                cents={summary.net}
                type={summary.net >= 0 ? 'income' : 'expense'}
                strong
                className="text-lg"
                countUp
              />
            </StatCard>
            <StatCard label="笔数" icon="records" index={3}>
              <span className="text-lg font-medium tabular-nums text-main">{summary.count} 笔</span>
            </StatCard>
          </div>

          <Card className="m-rise cinema-reveal" style={riseStyle(4)}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Icon name="chartUp" size={16} className="text-accent" />
                按年 · 月度趋势（{trendYear} 年）
              </div>
              <span className="text-xs text-muted">单位：元</span>
            </div>
            <div style={{ height: 260 }}>
              <ReactEChartsCore echarts={echarts} option={trendChart} style={{ height: '100%', width: '100%' }} />
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="m-rise cinema-reveal" style={riseStyle(5)}>
              <div className="flex items-center gap-1.5 text-sm font-medium mb-2">
                <Icon name="receipt" size={16} className="text-expense" />
                支出构成
              </div>
              {expenseSlices.length === 0 ? (
                <Empty text="这段时间没有支出" />
              ) : (
                <div style={{ height: 260 }}>
                  <ReactEChartsCore echarts={echarts} option={expenseChart} style={{ height: '100%', width: '100%' }} />
                </div>
              )}
            </Card>

            <Card className="m-rise cinema-reveal" style={riseStyle(6)}>
              <div className="flex items-center gap-1.5 text-sm font-medium mb-2">
                <Icon name="coins" size={16} className="text-income" />
                收入构成
              </div>
              {incomeSlices.length === 0 ? (
                <Empty text="这段时间没有收入" />
              ) : (
                <div style={{ height: 260 }}>
                  <ReactEChartsCore echarts={echarts} option={incomeChart} style={{ height: '100%', width: '100%' }} />
                </div>
              )}
            </Card>
          </div>

          <Card className="m-rise cinema-reveal" style={riseStyle(7)}>
            <div className="flex items-center gap-1.5 text-sm font-medium mb-3">
              <Icon name="stats" size={16} className="text-accent" />
              单笔极值 · 日均
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-soft px-4 py-3">
                <div className="text-xs text-muted">单笔最大支出</div>
                <div className="mt-1">
                  <MoneyText cents={summary.maxExpense} type="expense" strong className="text-base" />
                </div>
              </div>
              <div className="rounded-xl bg-soft px-4 py-3">
                <div className="text-xs text-muted">单笔最大收入</div>
                <div className="mt-1">
                  <MoneyText cents={summary.maxIncome} type="income" strong className="text-base" />
                </div>
              </div>
              <div className="rounded-xl bg-soft px-4 py-3">
                <div className="text-xs text-muted">日均支出</div>
                <div className="mt-1">
                  {dailyExpense === null ? (
                    <span className="text-base text-muted">—</span>
                  ) : (
                    <MoneyText cents={dailyExpense} type="expense" strong className="text-base" />
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
