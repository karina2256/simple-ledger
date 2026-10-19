import { noteColorOf } from '@shared/constants'
import { attachmentUrl } from '@shared/url'
import type { Attachment, RecordListItem } from '@shared/types'
import { Empty } from '../../components/ui'
import { MoneyText } from '../../components/MoneyText'
import { useAppStore } from '../../stores/app.store'
import { riseStyle } from '../../motion'

/**
 * 记录表格：记录页与日历日视图共用，避免两处各写一份行样式。
 */
export function RecordTable({
  items,
  onEdit,
  onDelete,
  onPreview,
  loading = false,
  emptyText = '还没有记录',
  emptyHint,
  showDate = true
}: {
  items: RecordListItem[]
  onEdit: (item: RecordListItem) => void
  onDelete: (item: RecordListItem) => void
  onPreview: (attachment: Attachment) => void
  loading?: boolean
  emptyText?: string
  emptyHint?: string
  showDate?: boolean
}): JSX.Element {
  const settings = useAppStore((state) => state.settings)

  const channelLabel = (key: string): string =>
    settings.channels.find((item) => item.key === key)?.label ?? key

  const categoryName = (item: RecordListItem): string => {
    if (item.type === 'transfer') return '转账'
    if (!item.categoryName) return '未分类'
    return item.categoryParentName ? `${item.categoryParentName} / ${item.categoryName}` : item.categoryName
  }

  if (items.length === 0) return <Empty text={loading ? '正在读取…' : emptyText} hint={loading ? undefined : emptyHint} />

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-muted border-b border-line">
          {showDate ? <th className="text-left font-normal px-4 h-10 w-28">日期</th> : null}
          <th className={`text-left font-normal ${showDate ? 'px-2' : 'px-4'} h-10 w-24`}>类型</th>
          <th className="text-left font-normal px-2 h-10">分类</th>
          <th className="text-left font-normal px-2 h-10 w-28">账户</th>
          <th className="text-left font-normal px-2 h-10">备注</th>
          <th className="text-left font-normal px-2 h-10 w-28">收据</th>
          <th className="text-right font-normal px-2 h-10 w-32">金额</th>
          <th className="text-right font-normal px-4 h-10 w-24">操作</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, index) => (
          <tr
            key={item.id}
            style={riseStyle(index)}
            className="m-rise cinema-row border-b border-line last:border-0 hover:bg-soft/60 transition-colors duration-m-quick"
          >
            {showDate ? <td className="px-4 py-2.5 text-muted">{item.date}</td> : null}
            <td className={`${showDate ? 'px-2' : 'px-4'} py-2.5`}>
              <span className="text-xs px-2 py-0.5 rounded-full bg-soft">{channelLabel(item.channel)}</span>
            </td>
            <td className="px-2 py-2.5">{categoryName(item)}</td>
            <td className="px-2 py-2.5 text-muted">
              {item.accountName ?? '—'}
              {item.toAccountName ? ` → ${item.toAccountName}` : ''}
            </td>
            <td className="px-2 py-2.5">
              <span className="inline-flex items-center gap-1.5">
                {item.note ? (
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ background: noteColorOf(item.note) }}
                  />
                ) : null}
                <span className={item.note ? '' : 'text-muted'}>{item.note || '—'}</span>
              </span>
              {item.tags.length ? (
                <span className="ml-2 text-xs text-muted">{item.tags.map((tag) => `#${tag}`).join(' ')}</span>
              ) : null}
            </td>
            <td className="px-2 py-2.5">
              <div className="flex gap-1">
                {item.attachments.map((attachment) => (
                  <button key={attachment.id} type="button" onClick={() => onPreview(attachment)}>
                    <img
                      src={attachmentUrl(attachment.filePath)}
                      alt={attachment.fileName}
                      className="w-8 h-8 object-cover rounded border border-line hover:border-accent transition"
                    />
                  </button>
                ))}
                {item.attachments.length === 0 ? <span className="text-muted">—</span> : null}
              </div>
            </td>
            <td className="px-2 py-2.5 text-right">
              <MoneyText cents={item.amount} type={item.type} signed={item.type !== 'transfer'} strong />
            </td>
            <td className="px-4 py-2.5 text-right whitespace-nowrap">
              <button
                type="button"
                className="m-press rounded px-1 text-xs text-muted hover:text-accent"
                onClick={() => onEdit(item)}
              >
                编辑
              </button>
              <button
                type="button"
                className="m-press rounded px-1 text-xs text-muted hover:text-danger ml-2"
                onClick={() => onDelete(item)}
              >
                删除
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
