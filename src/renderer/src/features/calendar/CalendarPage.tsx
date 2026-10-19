import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  addDays,
  addMonths,
  addYears,
  formatMonthDay,
  formatWeekday,
  isoWeekNumber,
  startOfWeek,
  todayKey
} from '@shared/date'
import { attachmentUrl } from '@shared/url'
import type { Attachment, RecordListItem } from '@shared/types'
import { Modal } from '../../components/ui'
import { RecordForm } from '../records/RecordForm'
import { DeleteRecordModal } from '../records/DeleteRecordModal'
import { DayView, MonthView, WeekView, YearView, type ViewProps } from './views'
import { useCalendarData, type CalendarView } from './useCalendarData'
import { useAppStore } from '../../stores/app.store'
import { withViewTransition } from '../../motion'

const VIEWS: { key: CalendarView; label: string }[] = [
  { key: 'year', label: '年' },
  { key: 'month', label: '月' },
  { key: 'week', label: '周' },
  { key: 'day', label: '日' }
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function normalizeView(raw: string | null): CalendarView {
  return raw === 'year' || raw === 'month' || raw === 'week' || raw === 'day' ? raw : 'month'
}

function normalizeDate(raw: string | null): string {
  return raw && DATE_RE.test(raw) ? raw : todayKey()
}

function shiftAnchor(view: CalendarView, anchor: string, delta: number): string {
  switch (view) {
    case 'year':
      return addYears(anchor, delta)
    case 'month':
      return addMonths(anchor, delta)
    case 'week':
      return addDays(anchor, delta * 7)
    case 'day':
    default:
      return addDays(anchor, delta)
  }
}

export function CalendarPage(): JSX.Element {
  const [params, setParams] = useSearchParams()
  const refreshAccounts = useAppStore((state) => state.refreshAccounts)

  const view = normalizeView(params.get('view'))
  const anchor = normalizeDate(params.get('date'))
  const data = useCalendarData(view, anchor)

  const [formDate, setFormDate] = useState<string | null>(null)
  const [editing, setEditing] = useState<RecordListItem | null>(null)
  const [deleting, setDeleting] = useState<RecordListItem | null>(null)
  const [preview, setPreview] = useState<Attachment | null>(null)

  const navigate = (nextView: CalendarView, date: string): void => {
    // 炫技档下切视图 / 翻页也走 View Transition：旧内容缩下去虚化、新内容弹上来
    withViewTransition(() => setParams({ view: nextView, date }))
  }

  const crumbs = useMemo(() => {
    const year = anchor.slice(0, 4)
    const monthStart = `${anchor.slice(0, 7)}-01`
    const monday = startOfWeek(anchor)
    const items: { label: string; view: CalendarView; date: string }[] = [
      { label: `${year}年`, view: 'year', date: `${year}-01-01` }
    ]
    if (view !== 'year') items.push({ label: `${Number(anchor.slice(5, 7))}月`, view: 'month', date: monthStart })
    if (view === 'week' || view === 'day') {
      items.push({ label: `第 ${isoWeekNumber(monday)} 周`, view: 'week', date: monday })
    }
    if (view === 'day') {
      items.push({ label: `${formatMonthDay(anchor)} ${formatWeekday(anchor)}`, view: 'day', date: anchor })
    }
    return items
  }, [anchor, view])

  const viewProps: ViewProps = {
    anchor,
    data,
    onNavigate: navigate,
    onPickDate: (date) => {
      setEditing(null)
      setFormDate(date)
    },
    onEditRecord: (item) => {
      setFormDate(null)
      setEditing(item)
    },
    onDeleteRecord: setDeleting,
    onPreview: setPreview
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5 gap-4">
        <nav className="flex items-center gap-1 text-sm min-w-0">
          {crumbs.map((crumb, index) => (
            <span key={crumb.label} className="flex items-center gap-1 min-w-0">
              {index > 0 ? <span className="text-muted">›</span> : null}
              <button
                type="button"
                onClick={() => navigate(crumb.view, crumb.date)}
                className={`m-press px-1.5 h-7 rounded-md truncate ${
                  index === crumbs.length - 1 ? 'text-main font-medium' : 'text-muted hover:text-accent'
                }`}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg bg-soft p-0.5">
            {VIEWS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.key, anchor)}
                className={`m-press px-3 h-8 rounded-md text-sm ${
                  view === item.key ? 'bg-card text-main shadow-sm font-medium' : 'text-muted hover:text-main'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg bg-soft p-0.5">
            <button
              type="button"
              onClick={() => navigate(view, shiftAnchor(view, anchor, -1))}
              className="m-press w-8 h-8 rounded-md text-muted hover:text-main"
              title="上一页"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => navigate(view, todayKey())}
              className="m-press px-3 h-8 rounded-md text-sm text-main"
            >
              今天
            </button>
            <button
              type="button"
              onClick={() => navigate(view, shiftAnchor(view, anchor, 1))}
              className="m-press w-8 h-8 rounded-md text-muted hover:text-main"
              title="下一页"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* 切视图 / 翻页时内容轻落位一次，方向感来自面包屑而不是转场特效 */}
      <div key={`${view}:${anchor}`} className="m-view">
        {view === 'year' ? <YearView {...viewProps} /> : null}
        {view === 'month' ? <MonthView {...viewProps} /> : null}
        {view === 'week' ? <WeekView {...viewProps} /> : null}
        {view === 'day' ? <DayView {...viewProps} /> : null}
      </div>

      <RecordForm
        open={formDate !== null || editing !== null}
        record={editing}
        defaultDate={formDate ?? editing?.date ?? anchor}
        onClose={() => {
          setFormDate(null)
          setEditing(null)
        }}
        onSaved={() => {
          void data.reload()
          void refreshAccounts()
        }}
      />

      {deleting ? (
        <DeleteRecordModal
          record={deleting}
          onClose={() => setDeleting(null)}
          onDone={async () => {
            await data.reload()
            await refreshAccounts()
          }}
        />
      ) : null}

      <Modal open={preview !== null} title={preview?.fileName ?? '收据'} onClose={() => setPreview(null)} width={720}>
        {preview ? (
          <div className="space-y-3">
            <img src={attachmentUrl(preview.filePath)} alt={preview.fileName} className="w-full rounded-lg border border-line" />
            <p className="text-xs text-muted">
              {preview.filePath} · {(preview.fileSize / 1024).toFixed(0)} KB
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
