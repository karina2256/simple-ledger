import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatCents, parseAmountToCents } from '@shared/money'
import { todayKey, formatFullCN } from '@shared/date'
import { describeFrequency, nextOccurrence } from '@shared/recurring'
import type { RecurringInput, RecurringRule, RecordType } from '@shared/types'
import { Button, Card, Empty, Field, Hint, Input, Modal, Segmented, Select } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAppStore } from '../../stores/app.store'
import { toast, toastError } from '../../stores/toast.store'

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`w-10 h-6 rounded-full transition relative shrink-0 ${checked ? 'bg-accent' : 'bg-line'}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  )
}

const EMPTY: RecurringInput = {
  name: '',
  amount: 0,
  type: 'expense',
  categoryId: null,
  accountId: null,
  toAccountId: null,
  frequency: 'monthly',
  interval: 1,
  startDate: todayKey(),
  endDate: null,
  enabled: true
}

/** 周期规则的显示名 */
function ruleSummary(rule: RecurringRule): string {
  const amount = `¥${formatCents(rule.amount)}`
  const direction = rule.type === 'income' ? '收入' : rule.type === 'transfer' ? '转账' : '支出'
  return `${describeFrequency(rule.frequency, rule.interval)} · ${direction} ${amount}`
}

export function RecurringPage(): JSX.Element {
  const accounts = useAppStore((state) => state.accounts)
  const categories = useAppStore((state) => state.categories)
  const settings = useAppStore((state) => state.settings)

  const [rules, setRules] = useState<RecurringRule[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RecurringInput>(EMPTY)
  const [amountText, setAmountText] = useState('')
  const [parentId, setParentId] = useState('')
  const [childId, setChildId] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRules(await window.api.recurring.list())
    } catch (error) {
      toastError(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const parentOptions = useMemo(
    () => categories.filter((node) => (form.type === 'income' ? node.type === 'income' : node.type === 'expense')),
    [categories, form.type]
  )
  const childOptions = useMemo(
    () => parentOptions.find((node) => node.id === parentId)?.children ?? [],
    [parentOptions, parentId]
  )

  const openCreate = (): void => {
    setEditingId(null)
    setForm({ ...EMPTY, accountId: accounts[0]?.id ?? null, startDate: todayKey() })
    setAmountText('')
    setParentId('')
    setChildId('')
    setOpen(true)
  }

  const openEdit = (rule: RecurringRule): void => {
    setEditingId(rule.id)
    setForm({
      name: rule.name,
      amount: rule.amount,
      type: rule.type,
      categoryId: rule.categoryId,
      accountId: rule.accountId,
      toAccountId: rule.toAccountId,
      frequency: rule.frequency,
      interval: rule.interval,
      startDate: rule.startDate,
      endDate: rule.endDate,
      enabled: rule.enabled
    })
    setAmountText(formatCents(rule.amount, false))
    const flat = categories.flatMap((node) => [node, ...node.children])
    const category = rule.categoryId ? flat.find((item) => item.id === rule.categoryId) : undefined
    setParentId(category?.parentId ?? category?.id ?? '')
    setChildId(category?.parentId ? category.id : '')
    setOpen(true)
  }

  const save = async (): Promise<void> => {
    const cents = parseAmountToCents(amountText)
    if (cents === null || cents === 0) return toast('金额请填写大于 0 的数字', 'error')
    setSaving(true)
    try {
      const payload: RecurringInput = {
        ...form,
        amount: cents,
        categoryId: form.type === 'transfer' ? null : childId || parentId || null,
        toAccountId: form.type === 'transfer' ? form.toAccountId : null,
        endDate: form.endDate || null
      }
      if (editingId) await window.api.recurring.update(editingId, payload)
      else await window.api.recurring.create(payload)
      await load()
      toast(editingId ? '规则已更新' : '规则已添加', 'ok')
      setOpen(false)
    } catch (error) {
      toastError(error)
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (rule: RecurringRule, enabled: boolean): Promise<void> => {
    try {
      await window.api.recurring.toggle(rule.id, enabled)
      await load()
    } catch (error) {
      toastError(error)
    }
  }

  const remove = async (rule: RecurringRule): Promise<void> => {
    if (!window.confirm(`确定删除周期规则「${rule.name}」吗？`)) return
    try {
      const result = await window.api.recurring.remove(rule.id)
      await load()
      toast(result.message ?? '已删除', result.ok ? 'ok' : 'warn')
    } catch (error) {
      toastError(error)
    }
  }

  const accountName = (id: string | null): string =>
    accounts.find((item) => item.id === id)?.name ?? '—'

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="cinema-page-title cinema-title text-xl font-medium">周期记账</h1>
        <Button type="button" variant="primary" onClick={openCreate}>
          <Icon name="plus" size={16} /> 新增规则
        </Button>
      </div>

      <Hint>
        周期规则默认只做标记，不会自动生成记录：标记会出现在日历的年 / 月 / 周 / 日四个视图里。
        需要自动生成时，去「设置 → 高级操作」打开开关（默认关闭）。
      </Hint>

      <div className="mt-4 space-y-2">
        {rules.length === 0 ? (
          <Card>
            <Empty
              text={loading ? '正在读取…' : '还没有周期记账规则'}
              hint={loading ? undefined : '比如「每月 1 号房租 2000」，建好之后日历上会看到标记'}
            />
          </Card>
        ) : (
          rules.map((rule) => (
            <Card key={rule.id} className="cinema-reveal !py-3" tilt>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${rule.enabled ? '' : 'text-muted line-through'}`}>
                      {rule.name}
                    </span>
                    <span className="text-xs text-muted">{ruleSummary(rule)}</span>
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    账户 {accountName(rule.accountId)}
                    {rule.toAccountId ? ` → ${accountName(rule.toAccountId)}` : ''} · 起 {rule.startDate}
                    {rule.endDate ? ` 止 ${rule.endDate}` : ' · 长期有效'} · 下次{' '}
                    {rule.enabled ? (nextOccurrence(rule, todayKey()) ?? '已结束') : '已停用'}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Toggle checked={rule.enabled} onChange={(value) => void toggle(rule, value)} />
                  <Button type="button" variant="ghost" className="h-8" onClick={() => openEdit(rule)}>
                    编辑
                  </Button>
                  <Button type="button" variant="danger" className="h-8" onClick={() => void remove(rule)}>
                    删除
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      <p className="text-xs text-muted mt-3">
        自动生成记录的开关当前为
        <span className="text-main"> {settings.autoGenerateRecurring ? '已开启' : '关闭'} </span>
        （第五轮接入自动生成逻辑；在此之前所有规则都只标记）。
      </p>

      <Modal
        open={open}
        title={editingId ? '编辑周期规则' : '新增周期规则'}
        onClose={() => setOpen(false)}
        width={620}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="规则名称">
            <Input
              value={form.name}
              placeholder="例如：每月房租"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>

          <Segmented
            value={form.type}
            onChange={(value: RecordType) => {
              setForm({ ...form, type: value, categoryId: null })
              setParentId('')
              setChildId('')
            }}
            options={[
              { value: 'expense', label: '支出' },
              { value: 'income', label: '收入' },
              { value: 'transfer', label: '转账' }
            ]}
          />

          <div className="grid grid-cols-2 gap-4">
            <Field label="金额（元）">
              <Input
                value={amountText}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(event) => setAmountText(event.target.value.replace(/[^\d.]/g, ''))}
              />
            </Field>
            <Field label={form.type === 'transfer' ? '转出账户' : '账户'}>
              <Select
                value={form.accountId ?? ''}
                onChange={(event) => setForm({ ...form, accountId: event.target.value || null })}
              >
                <option value="">请选择</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.icon} {account.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {form.type === 'transfer' ? (
            <Field label="转入账户">
              <Select
                value={form.toAccountId ?? ''}
                onChange={(event) => setForm({ ...form, toAccountId: event.target.value || null })}
              >
                <option value="">请选择</option>
                {accounts
                  .filter((account) => account.id !== form.accountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.icon} {account.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : (
            <Field label="分类" hint="只做标记时分类可以留空">
              <div className="flex gap-2">
                <Select
                  value={parentId}
                  onChange={(event) => {
                    setParentId(event.target.value)
                    setChildId('')
                  }}
                >
                  <option value="">不指定</option>
                  {parentOptions.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.icon} {node.name}
                    </option>
                  ))}
                </Select>
                <Select value={childId} disabled={childOptions.length === 0} onChange={(event) => setChildId(event.target.value)}>
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

          <div className="grid grid-cols-2 gap-4">
            <Field label="频率">
              <Select
                value={form.frequency}
                onChange={(event) => setForm({ ...form, frequency: event.target.value as RecurringInput['frequency'] })}
              >
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
                <option value="yearly">每年</option>
              </Select>
            </Field>
            <Field label="间隔" hint="1 表示每期，2 表示隔一期">
              <Input
                value={String(form.interval)}
                inputMode="numeric"
                onChange={(event) => {
                  const value = Number(event.target.value.replace(/[^\d]/g, '') || '1')
                  setForm({ ...form, interval: Math.min(365, Math.max(1, value)) })
                }}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="开始日期">
              <Input
                type="date"
                value={form.startDate}
                onChange={(event) => setForm({ ...form, startDate: event.target.value })}
              />
            </Field>
            <Field label="结束日期（可留空）">
              <Input
                type="date"
                value={form.endDate ?? ''}
                onChange={(event) => setForm({ ...form, endDate: event.target.value || null })}
              />
            </Field>
          </div>

          <label className="flex items-center gap-3 text-sm cursor-pointer">
            <Toggle checked={form.enabled} onChange={(value) => setForm({ ...form, enabled: value })} />
            启用这条规则（停用后日历上不会出现标记）
          </label>

          <p className="text-xs text-muted leading-5">
            预览：{form.name || '未命名'} · {describeFrequency(form.frequency, form.interval)} · 首次{' '}
            {formatFullCN(form.startDate)}
          </p>
        </div>
      </Modal>
    </div>
  )
}
