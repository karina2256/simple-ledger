import { useCallback, useEffect, useMemo, useState } from 'react'
import { attachmentUrl } from '@shared/url'
import type { Attachment, RecordListItem, RecordListResult } from '@shared/types'
import { Button, Card, Input, Modal } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { MoneyText } from '../../components/MoneyText'
import { RecordForm } from './RecordForm'
import { RecordTable } from './RecordTable'
import { DeleteRecordModal } from './DeleteRecordModal'
import { useAppStore } from '../../stores/app.store'
import { toastError } from '../../stores/toast.store'
import { riseStyle } from '../../motion'
import { NEW_RECORD_EVENT } from '../../shortcuts'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split('-').map(Number)
  const lastDay = new Date(year, mon, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(year, mon - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function RecordsPage(): JSX.Element {
  const refreshAccounts = useAppStore((state) => state.refreshAccounts)

  const [month, setMonth] = useState(currentMonth())
  const [allTime, setAllTime] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [data, setData] = useState<RecordListResult>({
    items: [],
    total: 0,
    incomeTotal: 0,
    expenseTotal: 0,
    transferTotal: 0
  })
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<RecordListItem | null>(null)
  const [preview, setPreview] = useState<Attachment | null>(null)
  const [deleting, setDeleting] = useState<RecordListItem | null>(null)

  const query = useMemo(() => {
    const base = allTime ? {} : monthRange(month)
    return { ...base, keyword: keyword.trim() || undefined, limit: 500 }
  }, [allTime, month, keyword])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await window.api.records.list(query))
    } catch (error) {
      toastError(error)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  // Ctrl+N：快捷键在 AppLayout 里统一监听，这里只负责把表单打开
  useEffect(() => {
    const openForm = (): void => {
      setEditing(null)
      setFormOpen(true)
    }
    window.addEventListener(NEW_RECORD_EVENT, openForm)
    return () => window.removeEventListener(NEW_RECORD_EVENT, openForm)
  }, [])

  const reload = async (): Promise<void> => {
    await load()
    await refreshAccounts()
  }

  const balance = data.incomeTotal - data.expenseTotal

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="cinema-page-title cinema-title text-xl font-medium">记录</h1>
          <div className="flex items-center gap-1 rounded-lg bg-soft p-0.5">
            <button
              type="button"
              className="m-press w-7 h-7 rounded-md text-muted hover:text-main disabled:opacity-40"
              onClick={() => setMonth(shiftMonth(month, -1))}
              disabled={allTime}
            >
              ‹
            </button>
            <button
              type="button"
              className="m-press px-2 h-7 rounded-md text-sm text-main"
              onClick={() => {
                setAllTime(false)
                setMonth(currentMonth())
              }}
            >
              {allTime ? '全部时间' : `${month.replace('-', ' 年 ')} 月`}
            </button>
            <button
              type="button"
              className="m-press w-7 h-7 rounded-md text-muted hover:text-main disabled:opacity-40"
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={allTime}
            >
              ›
            </button>
          </div>
          <Button type="button" variant={allTime ? 'primary' : 'ghost'} className="h-8" onClick={() => setAllTime(!allTime)}>
            全部时间
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="搜索备注 / 标签"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="!w-52 shrink-0"
          />
          <Button
            type="button"
            variant="primary"
            className="shrink-0 whitespace-nowrap"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Icon name="plus" size={16} /> 新增记录
          </Button>
        </div>
      </div>

      {/* 英雄区：往下滚时钉在顶部并缩小虚化，数字像 HUD 一样挂着 */}
      <section className="cinema-hero relative mb-5">
        <div className="grid grid-cols-3 gap-4">
          <Card className="m-rise !p-4" style={riseStyle(0)} tilt>
            <div className="text-xs text-muted mb-1">收入</div>
            <MoneyText cents={data.incomeTotal} type="income" className="text-lg" strong countUp />
          </Card>
          <Card className="m-rise !p-4" style={riseStyle(1)} tilt>
            <div className="text-xs text-muted mb-1">支出</div>
            <MoneyText cents={data.expenseTotal} type="expense" className="text-lg" strong countUp />
          </Card>
          <Card className="m-rise !p-4" style={riseStyle(2)} tilt>
            <div className="text-xs text-muted mb-1">结余</div>
            <MoneyText
              cents={Math.abs(balance)}
              type={balance >= 0 ? 'income' : 'expense'}
              className="text-lg"
              strong
              countUp
            />
          </Card>
        </div>
      </section>

      <Card padded={false}>
        <RecordTable
          items={data.items}
          loading={loading}
          emptyText="这个时间段还没有记录"
          emptyHint="点右上角「新增记录」记下第一笔"
          onEdit={(item) => {
            setEditing(item)
            setFormOpen(true)
          }}
          onDelete={setDeleting}
          onPreview={setPreview}
        />
      </Card>

      <p className="cinema-reveal text-xs text-muted mt-3">
        共 {data.total} 笔
        {data.transferTotal > 0 ? `（另有转账 ¥${(data.transferTotal / 100).toFixed(2)}，不计入收支）` : ''}
        {data.total > data.items.length ? ` · 列表最多显示 ${data.items.length} 笔，可用关键词缩小范围` : ''}
      </p>

      <RecordForm
        open={formOpen}
        record={editing}
        defaultDate={allTime ? undefined : `${month}-01`}
        onClose={() => setFormOpen(false)}
        onSaved={() => void reload()}
      />

      {deleting ? (
        <DeleteRecordModal record={deleting} onClose={() => setDeleting(null)} onDone={reload} />
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
