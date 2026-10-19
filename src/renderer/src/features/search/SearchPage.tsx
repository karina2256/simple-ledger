import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { todayKey } from '@shared/date'
import { attachmentUrl } from '@shared/url'
import { AMOUNT_BRACKETS } from '@shared/constants'
import type {
  AccountWithBalance,
  AmountBracket,
  Attachment,
  CategoryNode,
  RecordListItem,
  RecordListResult,
  RecordQuery,
  RecordType
} from '@shared/types'
import { Button, Card, Empty, Field, Hint, Input, Modal, Segmented, Select, Spinner } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { MoneyText } from '../../components/MoneyText'
import { RecordForm } from '../records/RecordForm'
import { RecordTable } from '../records/RecordTable'
import { DeleteRecordModal } from '../records/DeleteRecordModal'
import { toastError } from '../../stores/toast.store'

/**
 * 搜索页：多条件组合筛选账目 + 结果列表 + 编辑/删除。
 *
 * 查询策略（此处做一个明确选择）：条件变化后由 useEffect 触发「300ms 防抖自动查询」，
 * 不做「填完再点一下搜索按钮」——桌面端多一个按钮只是多一步。
 * 只有编辑保存 / 删除完成这两处会跳过防抖，直接调 load() 立刻重查，保证列表即时同步。
 */

/** 单次最多拉取的笔数，超出时提示用户缩小范围 */
const LIMIT = 200

const EMPTY_RESULT: RecordListResult = {
  items: [],
  total: 0,
  incomeTotal: 0,
  expenseTotal: 0,
  transferTotal: 0
}

type TypeFilter = 'all' | RecordType

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '转账' }
]

/** 默认区间：今天往前 3 个月的 1 号 → 今天，保证一进页面就有结果可看 */
function defaultRange(): { from: string; to: string } {
  const today = todayKey()
  const [year, month] = today.split('-').map(Number)
  const start = new Date(year, month - 1 - 3, 1)
  const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`
  return { from, to: today }
}

export function SearchPage(): JSX.Element {
  const initial = useMemo(defaultRange, [])

  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [childId, setChildId] = useState('')
  const [bracket, setBracket] = useState<'' | AmountBracket>('')

  const [accounts, setAccounts] = useState<AccountWithBalance[]>([])
  const [categories, setCategories] = useState<CategoryNode[]>([])

  const [data, setData] = useState<RecordListResult>(EMPTY_RESULT)
  const [loading, setLoading] = useState(false)

  const [editing, setEditing] = useState<RecordListItem | null>(null)
  const [deleting, setDeleting] = useState<RecordListItem | null>(null)
  const [preview, setPreview] = useState<Attachment | null>(null)

  // 下拉选项只加载一次：账户 / 分类的名字不会因为改一笔记录而变
  useEffect(() => {
    let alive = true
    window.api.accounts
      .list()
      .then((items) => {
        if (alive) setAccounts(items)
      })
      .catch(toastError)
    window.api.categories
      .tree()
      .then((nodes) => {
        if (alive) setCategories(nodes)
      })
      .catch(toastError)
    return () => {
      alive = false
    }
  }, [])

  const childOptions = useMemo(
    () => categories.find((node) => node.id === categoryId)?.children ?? [],
    [categories, categoryId]
  )

  const hasFilter = Boolean(
    keyword.trim() || from || to || type !== 'all' || accountId || categoryId || childId || bracket
  )

  /**
   * 条件 → RecordQuery：
   * 空值一律不传（undefined），让主进程按「该维度不限制」处理；
   * 分类只传一级 id 时主进程会自动带上它的子分类，选了二级分类就只按该子分类过滤；
   * 类型、金额档位都按数组传。
   */
  const query = useMemo<RecordQuery>(
    () => ({
      from: from || undefined,
      to: to || undefined,
      keyword: keyword.trim() || undefined,
      types: type === 'all' ? undefined : [type],
      accountIds: accountId ? [accountId] : undefined,
      categoryIds: childId ? [childId] : categoryId ? [categoryId] : undefined,
      amountBrackets: bracket ? [bracket] : undefined,
      limit: LIMIT
    }),
    [from, to, keyword, type, accountId, categoryId, childId, bracket]
  )

  // 请求序号：防抖窗口里连点/连改时，只认最后一次发出的结果，避免旧响应覆盖新结果
  const seq = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const ticket = ++seq.current
    setLoading(true)
    try {
      const result = await window.api.records.list(query)
      if (ticket === seq.current) setData(result)
    } catch (error) {
      if (ticket === seq.current) toastError(error)
    } finally {
      if (ticket === seq.current) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    if (!hasFilter) {
      seq.current += 1
      setData(EMPTY_RESULT)
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = window.setTimeout(() => {
      void load()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [hasFilter, load])

  const reset = (): void => {
    const range = defaultRange()
    setFrom(range.from)
    setTo(range.to)
    setKeyword('')
    setType('all')
    setAccountId('')
    setCategoryId('')
    setChildId('')
    setBracket('')
  }

  const truncated = data.total > data.items.length

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="cinema-page-title cinema-title text-xl font-medium">搜索</h1>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Icon name="search" size={16} />
          改任意条件都会自动查询
        </span>
      </div>

      <Card className="cinema-reveal mb-5">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          <Field label="关键词" hint="匹配备注或标签" className="col-span-2">
            <Input
              placeholder="搜索备注 / 标签"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </Field>

          <Field label="起始日">
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>

          <Field label="结束日">
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>

          <Field label="类型">
            <Segmented value={type} options={TYPE_OPTIONS} onChange={(value) => setType(value)} />
          </Field>

          <Field label="账户">
            <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">全部账户</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="分类">
            <Select
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value)
                setChildId('')
              }}
            >
              <option value="">全部分类</option>
              {categories.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="二级分类">
            <Select
              value={childId}
              disabled={!categoryId}
              onChange={(event) => setChildId(event.target.value)}
              className="disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">全部子分类</option>
              {childOptions.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="金额档位" hint="单位：元">
            <Select value={bracket} onChange={(event) => setBracket(event.target.value as '' | AmountBracket)}>
              <option value="">全部金额</option>
              {AMOUNT_BRACKETS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex items-end justify-between gap-4 mt-4">
          <Hint>
            默认查最近 3 个月。分类选一级会连带它的子分类；同组条件之间是「且」的关系。
          </Hint>
          <Button type="button" variant="default" className="shrink-0" onClick={reset}>
            <Icon name="refresh" size={16} /> 重置
          </Button>
        </div>
      </Card>

      <div className="cinema-reveal flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-xs text-muted">
        <span className="text-sm text-main">
          命中 <span className="font-medium">{data.total}</span> 笔
        </span>
        <span className="inline-flex items-center gap-1">
          收入
          <MoneyText cents={data.incomeTotal} type="income" strong />
        </span>
        <span className="inline-flex items-center gap-1">
          支出
          <MoneyText cents={data.expenseTotal} type="expense" strong />
        </span>
        {data.transferTotal > 0 ? (
          <span>转账 ¥{(data.transferTotal / 100).toFixed(2)}（不计入收支）</span>
        ) : null}
        {loading ? (
          <span className="inline-flex items-center gap-1.5 ml-auto">
            <Spinner /> 正在查询…
          </span>
        ) : null}
      </div>

      <Card padded={false}>
        {hasFilter ? (
          <RecordTable
            items={data.items}
            loading={loading}
            emptyText="没有符合条件的记录"
            emptyHint="换个关键词，或放宽日期 / 金额档位再试"
            onEdit={setEditing}
            onDelete={setDeleting}
            onPreview={setPreview}
          />
        ) : (
          <Empty text="输入条件开始搜索" hint="可按关键词、日期、类型、账户、分类、金额档位组合筛选" />
        )}
      </Card>

      {truncated ? (
        <p className="cinema-reveal text-xs text-muted mt-3">
          最多显示 {LIMIT} 笔，请缩小范围——当前命中 {data.total} 笔，只列出了前 {data.items.length} 笔。
        </p>
      ) : null}

      <RecordForm
        open={editing !== null}
        record={editing}
        onClose={() => setEditing(null)}
        onSaved={() => void load()}
      />

      {deleting ? (
        <DeleteRecordModal record={deleting} onClose={() => setDeleting(null)} onDone={() => void load()} />
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
