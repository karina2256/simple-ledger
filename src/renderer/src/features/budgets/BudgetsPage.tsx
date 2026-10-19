import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatCents, parseAmountToCents } from '@shared/money'
import type { BudgetPeriod, BudgetWithProgress, CategoryNode } from '@shared/types'
import { Button, Card, Empty, Field, Hint, Input, Modal, Segmented, Select, Spinner } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { MoneyText } from '../../components/MoneyText'
import { riseStyle, useShake } from '../../motion'
import { toast, toastError } from '../../stores/toast.store'

const PERIOD_LABEL: Record<BudgetPeriod, string> = { monthly: '每月', yearly: '每年' }

/**
 * 进度条三档配色：
 *   ratio < 0.8            → accent（从容）
 *   0.8 <= ratio <= 1      → warn（快满了）
 *   ratio > 1              → danger（超支）
 * 条宽固定 min(ratio, 1)*100%，超支只换颜色不溢出容器。
 */
function barColor(ratio: number): string {
  if (ratio > 1) return 'bg-danger'
  if (ratio >= 0.8) return 'bg-warn'
  return 'bg-accent'
}

function BudgetBar({ ratio, className }: { ratio: number; className?: string }): JSX.Element {
  const percent = Math.min(Math.max(ratio, 0), 1) * 100
  const danger = ratio > 1
  return (
    <div className={`h-1.5 w-full rounded-full bg-soft overflow-hidden ${className ?? ''}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${barColor(ratio)} ${danger ? 'cinema-pulse' : ''}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

/** 总预算没有分类；有父分类时显示「父 / 子」 */
function categoryLabel(item: BudgetWithProgress): string {
  if (!item.categoryId) return '总预算（所有支出）'
  if (!item.categoryName) return '已删除的分类'
  return item.categoryParentName ? `${item.categoryParentName} / ${item.categoryName}` : item.categoryName
}

/** 额度用完（或超支）时右侧显示「超支 ¥X」 */
function RemainingText({ item }: { item: BudgetWithProgress }): JSX.Element {
  if (item.remaining < 0) {
    return (
      <span className="text-danger whitespace-nowrap">
        超支 <MoneyText cents={-item.remaining} />
      </span>
    )
  }
  return (
    <span className="whitespace-nowrap">
      剩余 <MoneyText cents={item.remaining} />
    </span>
  )
}

interface BudgetFormState {
  categoryId: string
  period: BudgetPeriod
  amount: string
}

const EMPTY_FORM: BudgetFormState = { categoryId: '', period: 'monthly', amount: '' }

/**
 * 新增 / 编辑预算。
 *
 * create 在「同一分类 + 同一周期」已存在时后端会直接抛中文错误
 * （例如「这个分类已经有一条同周期的预算了，直接改那条就行」），这里必须 try/catch + toastError，
 * 把这句话原样呈现给用户，而不是吞掉或换一句笼统的提示。
 */
function BudgetDialog({
  open,
  editing,
  editingKey,
  parents,
  onClose,
  onSaved
}: {
  open: boolean
  editing: BudgetWithProgress | null
  /** 打开编辑时用来强制重挂载表单的标识（同一行连续编辑也能重新回填） */
  editingKey: string | null
  parents: CategoryNode[]
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [form, setForm] = useState<BudgetFormState>(EMPTY_FORM)
  const [amountError, setAmountError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { shakeKey, shake } = useShake()

  useEffect(() => {
    if (!open) return
    setForm(
      editing
        ? {
            categoryId: editing.categoryId ?? '',
            period: editing.period,
            amount: formatCents(editing.amount, false)
          }
        : EMPTY_FORM
    )
    setAmountError(null)
    setSaving(false)
  }, [open, editingKey])

  const save = async (): Promise<void> => {
    if (saving) return
    const cents = parseAmountToCents(form.amount)
    if (cents === null || cents <= 0) {
      setAmountError('额度请填写大于 0 的数字，最多两位小数')
      shake()
      return toast('额度请填写大于 0 的数字，最多两位小数', 'error')
    }
    setAmountError(null)
    setSaving(true)
    try {
      const input = {
        categoryId: form.categoryId || null,
        amount: cents,
        period: form.period
      }
      if (editing) await window.api.budgets.update(editing.id, input)
      else await window.api.budgets.create(input)
      toast('预算已保存', 'ok')
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
      title={editing ? '编辑预算' : '设置预算'}
      onClose={onClose}
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
        <Field label="分类" hint="预算按一级分类统计，二级分类的支出也会算进所属一级分类；选「总预算」则统计全部支出。">
          <Select
            value={form.categoryId}
            disabled={Boolean(editing)}
            onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
          >
            <option value="">总预算（所有支出）</option>
            {parents.map((node) => (
              <option key={node.id} value={node.id}>
                {node.icon} {node.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="周期" hint="额度按自然月 / 自然年重置，规则只需设一次。">
          <Segmented
            value={form.period}
            onChange={(value) => setForm({ ...form, period: value })}
            options={[
              { value: 'monthly', label: '每月' },
              { value: 'yearly', label: '每年' }
            ]}
          />
        </Field>

        <Field
          label="额度（元）"
          hint={amountError ? <span className="text-danger">{amountError}</span> : '只填数字，例如 1500 或 1500.50。'}
        >
          <div key={shakeKey} className={amountError ? 'm-shake' : undefined}>
            <Input
              inputMode="decimal"
              placeholder="0.00"
              value={form.amount}
              className={amountError ? 'border-danger focus:border-danger focus:ring-danger/20' : undefined}
              onChange={(event) => {
                setForm({ ...form, amount: event.target.value.replace(/[^\d.]/g, '') })
                if (amountError) setAmountError(null)
              }}
            />
          </div>
        </Field>
      </div>
    </Modal>
  )
}

/** 删除确认：只删规则，不动账 */
function DeleteBudgetDialog({
  item,
  onClose,
  onDone
}: {
  item: BudgetWithProgress
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.budgets.remove(item.id)
      if (!result.ok) toast(result.message ?? '删除失败', 'warn')
      else toast('预算已删除', 'ok')
      onDone()
      onClose()
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={`删除预算「${categoryLabel(item)}」`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="button" variant="danger" disabled={busy} onClick={() => void run()}>
            {busy ? (
              <>
                <Spinner />
                删除中…
              </>
            ) : (
              '确认删除'
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-6 text-main">
          确定删除「{categoryLabel(item)}」的{PERIOD_LABEL[item.period]}预算（额度{' '}
          {formatCents(item.amount)} 元）吗？
        </p>
        <p className="text-sm leading-6 text-muted">只删预算规则，不影响已记录的账。</p>
        <Hint>删掉后这条规则不再统计进度，已发生的支出和记录一条都不会被改动。</Hint>
      </div>
    </Modal>
  )
}

export function BudgetsPage(): JSX.Element {
  const [items, setItems] = useState<BudgetWithProgress[]>([])
  const [parents, setParents] = useState<CategoryNode[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BudgetWithProgress | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<BudgetWithProgress | null>(null)

  // 预算进度由后端按「当前周期」现算，所以每次变更后都整份重拉，不在前端自己加减金额
  const load = useCallback(async (): Promise<void> => {
    try {
      const [list, tree] = await Promise.all([window.api.budgets.list(), window.api.categories.tree()])
      setItems(list)
      setParents(tree.filter((node) => node.type === 'expense'))
    } catch (error) {
      toastError(error)
    } finally {
      setLoading(false)
    }
  }, [])

  // 只在挂载时拉一次；保存 / 删除后由各自流程主动重新 load
  useEffect(() => {
    void load()
  }, [load])

  // 总览卡优先看月度总预算，没有月度再退到年度总预算
  const overview = useMemo(
    () => items.find((item) => !item.categoryId && item.period === 'monthly') ?? items.find((item) => !item.categoryId) ?? null,
    [items]
  )
  const totalSpent = useMemo(
    () =>
      items
        .filter((item) => !item.categoryId)
        .reduce((max, item) => Math.max(max, item.spent), 0),
    [items]
  )

  const openCreate = (): void => {
    setEditing(null)
    setEditingKey(null)
    setDialogOpen(true)
  }

  const openEdit = (item: BudgetWithProgress): void => {
    setEditing(item)
    setEditingKey(item.id)
    setDialogOpen(true)
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="cinema-page-title cinema-title text-xl font-medium">预算</h1>
          <p className="text-xs text-muted mt-1.5">
            设一个月度或年度额度，进度按当前周期实时算；超支会标红。
          </p>
        </div>
        <Button type="button" variant="primary" className="shrink-0" onClick={openCreate}>
          <Icon name="plus" size={16} /> 设置预算
        </Button>
      </div>

      {loading ? (
        <Card className="m-rise cinema-reveal" style={riseStyle(0)}>
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted">
            <Spinner />
            正在计算预算进度…
          </div>
        </Card>
      ) : items.length === 0 ? (
        <Card className="m-rise cinema-reveal" style={riseStyle(0)}>
          <Empty
            text="还没有设置预算"
            hint="点右上角「＋ 设置预算」，先给「餐饮」设一个月度额度试试"
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {overview ? (
            <Card className="m-rise cinema-reveal" style={riseStyle(0)} tilt>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Icon name="budgets" />
                    <span>
                      {overview.period === 'yearly' ? '本年支出合计' : '本月支出合计'}
                      {overview.categoryId ? '' : ' vs 总预算'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <MoneyText cents={overview.spent} strong countUp className="text-3xl" />
                    <span className="text-sm text-muted">
                      已花 · 额度 {formatCents(overview.amount)} 元
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  {overview.exceeded ? (
                    <span className="text-sm text-danger flex items-center justify-end gap-1.5">
                      <Icon name="alert" />
                      已超支 {formatCents(Math.abs(overview.remaining))} 元
                    </span>
                  ) : (
                    <span className="text-sm text-muted">还在额度内，剩余 {formatCents(overview.remaining)} 元</span>
                  )}
                  <div className="text-xs text-muted mt-1">
                    周期 {overview.range.from} ~ {overview.range.to}
                  </div>
                </div>
              </div>
              <BudgetBar ratio={overview.ratio} className="mt-4" />
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span>已用 {(overview.ratio * 100).toFixed(1)}%</span>
                <span>100%</span>
              </div>
              {totalSpent > overview.amount ? (
                <p className="mt-3 text-xs text-danger flex items-center gap-1.5">
                  <Icon name="alert" />
                  已超支，先看看「餐饮」「购物」这类占比高的分类吧。
                </p>
              ) : (
                <p className="mt-3 text-xs text-muted flex items-center gap-1.5">
                  <Icon name="info" />
                  总预算是所有支出分类的合计口径；分类预算各自独立统计，互不抵扣。
                </p>
              )}
            </Card>
          ) : null}

          <div className="space-y-3">
            {items.map((item, index) => (
              <Card
                key={item.id}
                className="m-rise cinema-reveal"
                style={riseStyle(overview ? index + 1 : index, 10)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{categoryLabel(item)}</span>
                      <span className="shrink-0 rounded-full bg-soft px-2 h-6 inline-flex items-center text-xs text-muted">
                        {PERIOD_LABEL[item.period]}
                      </span>
                      {item.exceeded ? (
                        <span className="shrink-0 rounded-full bg-danger/10 px-2 h-6 inline-flex items-center gap-1 text-xs text-danger">
                          <Icon name="alert" />
                          已超支
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted mt-1">
                      {item.range.from} ~ {item.range.to}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button type="button" variant="ghost" className="h-8" onClick={() => openEdit(item)}>
                      <Icon name="edit" /> 编辑
                    </Button>
                    <Button type="button" variant="danger" className="h-8" onClick={() => setDeleting(item)}>
                      <Icon name="trash" /> 删除
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm">
                  <span className="text-muted">
                    额度 <span className="text-main tabular-nums">{formatCents(item.amount)} 元</span>
                  </span>
                  <span className="text-muted">
                    已花 <span className="text-main tabular-nums">{formatCents(item.spent)} 元</span>
                  </span>
                  <span className="text-muted">
                    <RemainingText item={item} />
                  </span>
                  <span className={`tabular-nums ${item.exceeded ? 'text-danger' : 'text-muted'}`}>
                    {(item.ratio * 100).toFixed(1)}%
                  </span>
                </div>

                <BudgetBar ratio={item.ratio} className="mt-3" />

                {item.exceeded ? (
                  <p className="mt-3 text-xs text-danger flex items-center gap-1.5">
                    <Icon name="alert" />
                    已经超出额度 {formatCents(Math.abs(item.remaining))} 元，这个周期还剩下 {item.range.to}。
                  </p>
                ) : item.ratio >= 0.8 ? (
                  <p className="mt-3 text-xs text-warn flex items-center gap-1.5">
                    <Icon name="alert" />
                    额度快用完了，已用 {(item.ratio * 100).toFixed(0)}%。
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-muted flex items-center gap-1.5">
                    <Icon name="check" />
                    节奏正常，还剩 {formatCents(item.remaining)} 元。
                  </p>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {dialogOpen ? (
        <BudgetDialog
          open={dialogOpen}
          editing={editing}
          editingKey={editingKey}
          parents={parents}
          onClose={() => setDialogOpen(false)}
          onSaved={() => void load()}
        />
      ) : null}

      {deleting ? (
        <DeleteBudgetDialog
          item={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => void load()}
        />
      ) : null}
    </div>
  )
}
