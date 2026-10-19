import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { dateKey, pad2 } from '@shared/date'
import type { RecordListItem, RecordListResult, RecordType } from '@shared/types'
import { Button, Card, Empty, Hint, Modal, Spinner } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { MoneyText } from '../../components/MoneyText'
import { riseStyle } from '../../motion'
import { useAppStore } from '../../stores/app.store'
import { toast, toastError } from '../../stores/toast.store'

/** 回收站一次读取的最大条数，与记录页保持一致 */
const PAGE_SIZE = 500

const TYPE_LABEL: Record<RecordType, string> = {
  income: '收入',
  expense: '支出',
  transfer: '转账'
}

const EMPTY_RESULT: RecordListResult = {
  items: [],
  total: 0,
  incomeTotal: 0,
  expenseTotal: 0,
  transferTotal: 0
}

/**
 * 删除时间：deleted_at 是毫秒时间戳，用本地时间显示成 YYYY-MM-DD HH:mm。
 * 走 SharedDate 的 dateKey / pad2，不手写补零，避免和别的页面格式化出两套结果。
 */
function formatDeletedAt(timestamp: number | null): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  return `${dateKey(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function categoryName(item: RecordListItem): string {
  if (item.type === 'transfer') return '转账'
  if (!item.categoryName) return '未分类'
  return item.categoryParentName ? `${item.categoryParentName} / ${item.categoryName}` : item.categoryName
}

/** 待确认的彻底删除：purge = 删所选，empty = 清空回收站 */
interface PendingPurge {
  mode: 'purge' | 'empty'
  ids: string[]
}

/**
 * 回收站：列出已软删除的记录，支持恢复 / 彻底删除 / 清空。
 *
 * 注意这里不复用 RecordTable —— 它按「未删除」的视角写死了列与操作（编辑 / 删除），
 * 回收站要多一列删除时间、多一列勾选框，操作也完全不同，另写一份更清楚。
 */
export function RecycleBinPage(): JSX.Element {
  const refreshAccounts = useAppStore((state) => state.refreshAccounts)

  const [data, setData] = useState<RecordListResult>(EMPTY_RESULT)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [pending, setPending] = useState<PendingPurge | null>(null)
  const [dropFiles, setDropFiles] = useState(false)
  const [busy, setBusy] = useState(false)

  const headRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.api.records.list({ onlyDeleted: true, limit: PAGE_SIZE })
      setData(result)
      // 重新加载后把已经不存在的勾选清掉，否则底部操作条会拿着旧 id 去删
      setSelected((ids) => ids.filter((id) => result.items.some((item) => item.id === id)))
    } catch (error) {
      toastError(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const items = data.items
  const allSelected = items.length > 0 && selected.length === items.length

  // 全选框的第三态：选了但没选满。DOM 属性只能命令式写，所以用 ref + effect
  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = selected.length > 0 && !allSelected
  }, [selected.length, allSelected])

  /** 待删除记录里的收据总数，决定弹窗要不要给「同时删除收据文件」的选项 */
  const pendingAttachments = useMemo(() => {
    if (!pending) return 0
    return items
      .filter((item) => pending.ids.includes(item.id))
      .reduce((sum, item) => sum + item.attachments.length, 0)
  }, [pending, items])

  const toggleOne = (id: string): void => {
    setSelected((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))
  }

  const toggleAll = (): void => {
    setSelected(allSelected ? [] : items.map((item) => item.id))
  }

  const openPurge = (ids: string[], mode: PendingPurge['mode']): void => {
    if (ids.length === 0) return
    setDropFiles(false)
    setPending({ mode, ids })
  }

  const closePending = (): void => {
    if (busy) return
    setPending(null)
  }

  const runRestore = async (ids: string[]): Promise<void> => {
    if (ids.length === 0 || busy) return
    setBusy(true)
    try {
      const result = await window.api.records.restore(ids)
      await refreshAccounts()
      await load()
      setSelected([])
      toast(result.message ?? `已恢复 ${ids.length} 笔`, 'ok')
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  const runPurge = async (): Promise<void> => {
    if (!pending || pending.ids.length === 0 || busy) return
    const ids = pending.ids
    setBusy(true)
    try {
      const result = await window.api.records.purge(ids, dropFiles)
      await refreshAccounts()
      await load()
      setSelected([])
      setPending(null)
      toast(result.message ?? `已彻底删除 ${ids.length} 笔`, 'ok')
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="cinema-page-title cinema-title text-xl font-medium">回收站</h1>
          <p className="text-xs text-muted mt-1">
            删除的记录会先放到这里，可以恢复；彻底删除后不可恢复。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            className="whitespace-nowrap"
            disabled={loading || busy}
            onClick={() => void load()}
          >
            <Icon name="refresh" size={16} /> 刷新
          </Button>
          <Button
            type="button"
            variant="danger"
            className="whitespace-nowrap"
            disabled={items.length === 0 || busy}
            onClick={() => openPurge(items.map((item) => item.id), 'empty')}
          >
            <Icon name="trash" size={16} /> 清空回收站
          </Button>
        </div>
      </div>

      <Card padded={false} className="cinema-reveal">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Spinner /> 正在读取…
          </div>
        ) : items.length === 0 ? (
          <Empty text="回收站是空的" hint="删除记录后可以在这里恢复" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted border-b border-line">
                <th className="text-left font-normal px-4 h-10 w-10">
                  <input
                    ref={headRef}
                    type="checkbox"
                    className="cursor-pointer align-middle"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="全选"
                  />
                </th>
                <th className="text-left font-normal px-2 h-10 w-36">删除时间</th>
                <th className="text-left font-normal px-2 h-10 w-28">日期</th>
                <th className="text-left font-normal px-2 h-10 w-20">类型</th>
                <th className="text-left font-normal px-2 h-10">分类</th>
                <th className="text-left font-normal px-2 h-10 w-28">账户</th>
                <th className="text-left font-normal px-2 h-10">备注</th>
                <th className="text-right font-normal px-2 h-10 w-32">金额</th>
                <th className="text-right font-normal px-4 h-10 w-28">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr
                  key={item.id}
                  style={riseStyle(index, 12)}
                  className="m-rise cinema-row border-b border-line last:border-0 hover:bg-soft/60 transition-colors duration-m-quick"
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      className="cursor-pointer align-middle"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleOne(item.id)}
                      aria-label={`选择 ${item.date} 的记录`}
                    />
                  </td>
                  <td className="px-2 py-2.5 text-muted whitespace-nowrap">{formatDeletedAt(item.deletedAt)}</td>
                  <td className="px-2 py-2.5 text-muted">{item.date}</td>
                  <td className="px-2 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-soft">{TYPE_LABEL[item.type]}</span>
                  </td>
                  <td className="px-2 py-2.5">{categoryName(item)}</td>
                  <td className="px-2 py-2.5 text-muted">
                    {item.accountName ?? '—'}
                    {item.toAccountName ? ` → ${item.toAccountName}` : ''}
                  </td>
                  <td className="px-2 py-2.5">
                    <span className={item.note ? '' : 'text-muted'}>{item.note || '—'}</span>
                    {item.tags.length ? (
                      <span className="ml-2 text-xs text-muted">{item.tags.map((tag) => `#${tag}`).join(' ')}</span>
                    ) : null}
                    {item.attachments.length ? (
                      <span className="ml-2 text-xs text-muted">· {item.attachments.length} 张收据</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <MoneyText cents={item.amount} type={item.type} signed={item.type !== 'transfer'} strong />
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="m-press rounded px-1 text-xs text-muted hover:text-accent disabled:opacity-40"
                      disabled={busy}
                      onClick={() => void runRestore([item.id])}
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      className="m-press rounded px-1 text-xs text-muted hover:text-danger ml-2 disabled:opacity-40"
                      disabled={busy}
                      onClick={() => openPurge([item.id], 'purge')}
                    >
                      彻底删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p className="cinema-reveal text-xs text-muted mt-3">
        共 {data.total} 笔待清理
        {data.total > items.length ? ` · 列表最多显示 ${items.length} 笔` : ''}
      </p>

      {selected.length > 0 ? (
        <Card className="cinema-reveal sticky bottom-4 z-10 mt-4 !py-3 flex items-center justify-between gap-4">
          <div className="text-sm text-main">
            已选 <span className="font-medium tabular-nums">{selected.length}</span> 笔
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" disabled={busy} onClick={() => void runRestore([...selected])}>
              <Icon name="refresh" size={16} /> 恢复所选
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => openPurge([...selected], 'purge')}
            >
              <Icon name="trash" size={16} /> 彻底删除所选
            </Button>
          </div>
        </Card>
      ) : null}

      <Modal
        open={pending !== null}
        title={pending?.mode === 'empty' ? '清空回收站' : '彻底删除'}
        onClose={closePending}
        width={520}
        footer={
          <>
            <Button type="button" variant="ghost" disabled={busy} onClick={closePending}>
              取消
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={() => void runPurge()}>
              彻底删除
            </Button>
          </>
        }
      >
        {pending ? (
          <div className="space-y-4">
            <p className="text-sm text-main leading-6">
              {pending.mode === 'empty'
                ? `回收站里的 ${pending.ids.length} 笔记录将被彻底删除，此操作不可恢复。`
                : `选中的 ${pending.ids.length} 笔记录将被彻底删除，此操作不可恢复。`}
            </p>

            {pendingAttachments > 0 ? (
              <label className="flex items-start gap-2 rounded-xl bg-soft p-3 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={dropFiles}
                  onChange={(event) => setDropFiles(event.target.checked)}
                />
                <span className="leading-5">
                  同时删除这 {pendingAttachments} 个收据文件
                  <span className="text-muted block">
                    默认保留：图片会继续留在数据目录，需要时还能找回。
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-muted">选中的记录没有收据附件。</p>
            )}

            <Hint>记录删除后不再出现在任何列表、统计和导出里，恢复只能靠数据目录的备份。</Hint>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
