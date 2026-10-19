import { useEffect, useMemo, useRef, useState } from 'react'
import { noteColorOf } from '@shared/constants'
import { formatCents, parseAmountToCents } from '@shared/money'
import { attachmentUrl } from '@shared/url'
import { Icon } from '../../components/Icon'
import type { Attachment, RecordListItem, RecordType } from '@shared/types'
import { Button, Field, Hint, Input, Modal, Segmented, Select, Spinner } from '../../components/ui'
import { useAppStore } from '../../stores/app.store'
import { toast, toastError } from '../../stores/toast.store'
import { useShake } from '../../motion'

function today(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

export function RecordForm({
  open,
  record,
  defaultDate,
  onClose,
  onSaved
}: {
  open: boolean
  record: RecordListItem | null
  defaultDate?: string
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const accounts = useAppStore((state) => state.accounts)
  const categories = useAppStore((state) => state.categories)
  const settings = useAppStore((state) => state.settings)

  const [type, setType] = useState<RecordType>('expense')
  const [date, setDate] = useState(defaultDate ?? today())
  const [amount, setAmount] = useState('')
  const [channel, setChannel] = useState('offline')
  const [accountId, setAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [parentId, setParentId] = useState('')
  const [childId, setChildId] = useState('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [existing, setExisting] = useState<Attachment[]>([])
  const [staged, setStaged] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  // 校验失败：金额框抖一下 + 就地出红字。shakeKey 用来重启动画，amountRef 用来把焦点带回去
  const [amountError, setAmountError] = useState<string | null>(null)
  const { shakeKey, shake } = useShake()
  const amountRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (shakeKey > 0) amountRef.current?.focus()
  }, [shakeKey])

  // 打开时用传入的记录（或空白）重置表单。
  // 这里刻意只依赖 open / record：账户或分类在别处被改动时，不该把正在填的表单清空。
  const latest = useRef({ accounts, categories })
  latest.current = { accounts, categories }
  useEffect(() => {
    if (!open) return
    const { accounts: accountList, categories: categoryList } = latest.current
    if (record) {
      setType(record.type)
      setDate(record.date)
      setAmount(formatCents(record.amount, false))
      setChannel(record.channel)
      setAccountId(record.accountId ?? '')
      setToAccountId(record.toAccountId ?? '')
      setNote(record.note)
      setTags(record.tags)
      setExisting(record.attachments)
      const category = record.categoryId
        ? categoryList.flatMap((node) => [node, ...node.children]).find((item) => item.id === record.categoryId)
        : undefined
      if (category?.parentId) {
        setParentId(category.parentId)
        setChildId(category.id)
      } else {
        setParentId(category?.id ?? '')
        setChildId('')
      }
    } else {
      setType('expense')
      setDate(defaultDate ?? today())
      setAmount('')
      setChannel('offline')
      setAccountId(accountList[0]?.id ?? '')
      setToAccountId('')
      setParentId('')
      setChildId('')
      setNote('')
      setTags([])
      setExisting([])
    }
    setStaged([])
    setTagInput('')
  }, [open, record, defaultDate])

  const parentOptions = useMemo(
    () => categories.filter((node) => (type === 'income' ? node.type === 'income' : node.type === 'expense')),
    [categories, type]
  )
  const childOptions = useMemo(
    () => parentOptions.find((node) => node.id === parentId)?.children ?? [],
    [parentOptions, parentId]
  )
  const noteColor = note === '' ? '#8A9BA8' : noteColorOf(note)

  const addTag = (): void => {
    const value = tagInput.trim().replace(/^#/, '')
    if (!value) return
    if (!tags.includes(value)) setTags([...tags, value])
    setTagInput('')
  }

  const pickImages = async (): Promise<void> => {
    try {
      const picked = await window.api.attachments.pickImages()
      if (picked.length) setStaged([...staged, ...picked])
    } catch (error) {
      toastError(error)
    }
  }

  const removeExisting = async (id: string): Promise<void> => {
    try {
      await window.api.attachments.remove(id)
      setExisting(existing.filter((item) => item.id !== id))
      toast('收据已移除', 'ok')
    } catch (error) {
      toastError(error)
    }
  }

  const save = async (): Promise<void> => {
    const cents = parseAmountToCents(amount)
    if (cents === null) {
      setAmountError('金额请填写数字，最多两位小数')
      shake()
      return toast('金额请填写数字，最多两位小数', 'error')
    }
    if (cents === 0) {
      setAmountError('金额不能为 0')
      shake()
      return toast('金额不能为 0', 'error')
    }
    setAmountError(null)
    setSaving(true)
    try {
      const payload = {
        date,
        amount: cents,
        type,
        channel: type === 'transfer' ? 'transfer' : channel,
        categoryId: type === 'transfer' ? null : childId || parentId || null,
        accountId: accountId || null,
        toAccountId: type === 'transfer' ? toAccountId || null : null,
        note: note.trim(),
        noteColor: null,
        tags
      }
      const saved = record
        ? await window.api.records.update(record.id, payload)
        : await window.api.records.create(payload)
      if (staged.length) await window.api.attachments.add(saved.id, staged)
      toast(record ? '已保存修改' : '已记录一笔', 'ok')
      onSaved()
      onClose()
    } catch (error) {
      toastError(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={record ? '编辑记录' : '新增记录'}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? (
              <>
                <Spinner />
                保存中…
              </>
            ) : (
              '保存'
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Segmented
            value={type}
            onChange={(value) => {
              setType(value)
              setParentId('')
              setChildId('')
              if (value === 'transfer') setChannel('transfer')
            }}
            options={[
              { value: 'expense', label: '支出' },
              { value: 'income', label: '收入' },
              { value: 'transfer', label: '转账' }
            ]}
          />
          {type !== 'transfer' ? (
            <Select value={channel} onChange={(event) => setChannel(event.target.value)} className="!w-40">
              {settings.channels.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.icon} {item.label}
                </option>
              ))}
            </Select>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="日期">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field
            label="金额（元）"
            hint={amountError ? <span className="text-danger">{amountError}</span> : undefined}
          >
            <div key={shakeKey} className={amountError ? 'm-shake' : undefined}>
              <Input
                ref={amountRef}
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                className={amountError ? 'border-danger focus:border-danger focus:ring-danger/20' : undefined}
                onChange={(event) => {
                  setAmount(event.target.value.replace(/[^\d.]/g, ''))
                  if (amountError) setAmountError(null)
                }}
              />
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={type === 'transfer' ? '转出账户' : '账户'}>
            <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">请选择</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.icon} {account.name}
                </option>
              ))}
            </Select>
          </Field>
          {type === 'transfer' ? (
            <Field label="转入账户">
              <Select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
                <option value="">请选择</option>
                {accounts
                  .filter((account) => account.id !== accountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.icon} {account.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : (
            <Field label="分类">
              <div className="flex gap-2">
                <Select
                  value={parentId}
                  onChange={(event) => {
                    setParentId(event.target.value)
                    setChildId('')
                  }}
                >
                  <option value="">请选择</option>
                  {parentOptions.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.icon} {node.name}
                    </option>
                  ))}
                </Select>
                <Select
                  value={childId}
                  disabled={childOptions.length === 0}
                  onChange={(event) => setChildId(event.target.value)}
                >
                  <option value="">（子分类）</option>
                  {childOptions.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.icon} {child.name}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
          )}
        </div>

        <Field
          label="备注"
          hint={
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: noteColor }} />
              相同备注会自动使用相同颜色，用于在列表里一眼分辨
            </span>
          }
        >
          <Input placeholder="例如：公司楼下的麻辣烫" value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>

        <Field label="标签">
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-soft px-2.5 h-7 text-xs">
                #{tag}
                <button
                  type="button"
                  className="text-muted hover:text-danger"
                  onClick={() => setTags(tags.filter((item) => item !== tag))}
                >
                  ✕
                </button>
              </span>
            ))}
            <Input
              value={tagInput}
              placeholder="输入后回车"
              className="!w-32"
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addTag()
                }
              }}
            />
          </div>
        </Field>

        <Field label="收据截图">
          <div className="flex flex-wrap gap-2">
            {existing.map((item) => (
              <div key={item.id} className="relative group">
                <img
                  src={attachmentUrl(item.filePath)}
                  alt={item.fileName}
                  className="w-20 h-20 object-cover rounded-lg border border-line"
                />
                <button
                  type="button"
                  onClick={() => void removeExisting(item.id)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white text-xs opacity-0 group-hover:opacity-100 transition"
                >
                  ✕
                </button>
              </div>
            ))}
            {staged.map((filePath) => (
              <div key={filePath} className="relative group w-20 h-20 rounded-lg border border-dashed border-accent flex flex-col items-center justify-center p-1">
                <span className="text-lg">🖼️</span>
                <span className="text-[10px] text-muted text-center leading-3 break-all line-clamp-2">
                  {baseName(filePath)}
                </span>
                <span className="absolute top-0 left-0 right-0 text-[10px] text-center text-accent">待保存</span>
                <button
                  type="button"
                  onClick={() => setStaged(staged.filter((item) => item !== filePath))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white text-xs opacity-0 group-hover:opacity-100 transition"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => void pickImages()}
              className="w-20 h-20 rounded-lg border border-dashed border-line text-muted hover:border-accent hover:text-accent transition text-xl"
            >
              <Icon name="plus" size={20} />
            </button>
          </div>
        </Field>
        <Hint>
          图片会复制到数据目录的 attachments 文件夹，数据库里只存相对路径。选中的图片在保存记录后才会真正写入。
        </Hint>
      </div>
    </Modal>
  )
}
