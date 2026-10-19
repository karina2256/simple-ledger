import { useEffect, useState } from 'react'
import { formatCents, parseAmountToCents } from '@shared/money'
import type { AccountInput, AccountUsage, AccountWithBalance, MigrateResult } from '@shared/types'
import { Button, Card, Empty, Field, Input, Modal, Segmented, Spinner } from '../../components/ui'
import { EntityIcon, Icon } from '../../components/Icon'
import { MoneyText } from '../../components/MoneyText'
import { useAppStore } from '../../stores/app.store'
import { toast, toastError } from '../../stores/toast.store'
import { riseStyle, useShake } from '../../motion'

const COLORS = ['#4FB3A5', '#4A9BD1', '#7B8CE0', '#A97BD1', '#D96BA8', '#E8836B', '#C4B24A', '#7FBF7A', '#8A9BA8']

const EMPTY: AccountInput = { name: '', icon: '💳', color: COLORS[0], initialBalance: 0 }

/**
 * 删除账户的分支：
 *  - 余额为 0 且没有任何记录 / 周期规则 → 直接真删
 *  - 其它情况 → 二选一：归档，或迁移到目标账户后归档
 */
function DeleteAccountModal({
  account,
  others,
  onClose,
  onDone
}: {
  account: AccountWithBalance
  others: AccountWithBalance[]
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const [usage, setUsage] = useState<AccountUsage | null>(null)
  const [mode, setMode] = useState<'archive' | 'migrate'>('archive')
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)

  const firstOtherId = others[0]?.id ?? ''
  // 只依赖账户 id：others 是父组件里临时生成的数组，写进依赖会无限重跑
  useEffect(() => {
    setTargetId(firstOtherId)
    window.api.accounts
      .usage(account.id)
      .then(setUsage)
      .catch(toastError)
  }, [account.id, firstOtherId])

  const canHardDelete = usage?.canHardDelete ?? false

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      if (canHardDelete) {
        const result = await window.api.accounts.remove(account.id)
        if (!result.ok) toast(result.message ?? '删除失败', 'warn')
        else toast('账户已删除', 'ok')
      } else if (mode === 'archive') {
        const result = await window.api.accounts.archive(account.id)
        toast(result.message ?? (result.ok ? '账户已归档' : '归档失败'), result.ok ? 'ok' : 'warn')
      } else {
        if (!targetId) return toast('请选择迁移到的目标账户', 'error')
        const result: MigrateResult = await window.api.accounts.migrateAndArchive(account.id, targetId)
        if (!result.ok) return toast(result.message ?? '迁移失败', 'warn')
        const extra = [
          `迁移 ${result.movedRecords ?? 0} 笔记录`,
          result.movedRecurring ? `迁移 ${result.movedRecurring} 条周期规则` : null,
          result.mergedTransfers ? `${result.mergedTransfers} 笔内部转账已置为删除` : null
        ]
          .filter(Boolean)
          .join('，')
        toast(`${result.message}（${extra}）`, 'ok')
      }
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
      title={`删除账户「${account.name}」`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            variant={canHardDelete ? 'danger' : 'primary'}
            disabled={busy || (!canHardDelete && mode === 'migrate' && others.length === 0)}
            onClick={() => void run()}
          >
            {canHardDelete ? '确认删除' : mode === 'archive' ? '归档' : '迁移并归档'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!usage ? (
          <p className="text-sm text-muted">正在读取该账户的使用情况…</p>
        ) : canHardDelete ? (
          <p className="text-sm leading-6">
            该账户余额为 0，也没有关联的记录和周期规则，可以安全删除。删除后不可恢复。
          </p>
        ) : (
          <>
            <div className="rounded-xl bg-soft p-4 text-sm leading-6">
              <div>
                当前余额 <MoneyText cents={usage.balance} strong />
              </div>
              <div className="text-muted">
                关联 {usage.recordCount} 笔记录 · {usage.recurringCount} 条周期规则 · {usage.budgetCount} 条账户预算
              </div>
            </div>
            <Segmented
              value={mode}
              onChange={(value) => setMode(value)}
              options={[
                { value: 'archive', label: '仅归档' },
                { value: 'migrate', label: '迁移到其它账户并归档' }
              ]}
            />
            {mode === 'archive' ? (
              <p className="text-xs text-muted leading-5">
                归档后该账户不再出现在新增 / 编辑记录的下拉与筛选中，历史记录仍然显示它的名字和金额。
                之后可以在「设置 → 已归档账户」里恢复。
              </p>
            ) : (
              <div className="space-y-3">
                <Field label="迁移到">
                  <select
                    value={targetId}
                    onChange={(event) => setTargetId(event.target.value)}
                    className="h-9 w-full rounded-lg border border-line bg-card px-3 text-sm text-main outline-none focus:border-accent"
                  >
                    {others.length === 0 ? <option value="">没有其它在用账户</option> : null}
                    {others.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.icon} {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="text-xs text-muted leading-5">
                  该账户的记录与周期规则会转到目标账户，初始余额也会一并并入，源账户随后自动归档。
                  原本在两者之间的转账合并后会变成「自己转自己」，这类记录会被置为已删除（可恢复，不影响余额）。
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

export function AccountsPage(): JSX.Element {
  const accounts = useAppStore((state) => state.accounts)
  const refreshAccounts = useAppStore((state) => state.refreshAccounts)

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<AccountInput>(EMPTY)
  const [balanceText, setBalanceText] = useState('0.00')
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const { shakeKey, shake } = useShake()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<AccountWithBalance | null>(null)

  const openCreate = (): void => {
    setEditingId(null)
    setForm(EMPTY)
    setBalanceText('0.00')
    setOpen(true)
  }

  const openEdit = (account: AccountWithBalance): void => {
    setEditingId(account.id)
    setForm({
      name: account.name,
      icon: account.icon,
      color: account.color,
      initialBalance: account.initialBalance
    })
    setBalanceText(formatCents(account.initialBalance, false))
    setOpen(true)
  }

  const save = async (): Promise<void> => {
    const cents = parseAmountToCents(balanceText || '0')
    if (cents === null) {
      setBalanceError('初始余额请填写 0 或正数，最多两位小数')
      shake()
      return toast('初始余额请填写 0 或正数，最多两位小数', 'error')
    }
    setBalanceError(null)
    setSaving(true)
    try {
      const payload = { ...form, initialBalance: cents }
      if (editingId) await window.api.accounts.update(editingId, payload)
      else await window.api.accounts.create(payload)
      await refreshAccounts()
      toast(editingId ? '账户已更新' : '账户已添加', 'ok')
      setOpen(false)
    } catch (error) {
      toastError(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="cinema-page-title cinema-title text-xl font-medium">账户</h1>
        <Button type="button" variant="primary" onClick={openCreate}>
          <Icon name="plus" size={16} /> 新增账户
        </Button>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <Empty text="还没有账户" hint="先建一个微信或支付宝账户，就能开始记账了" />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {accounts.map((account, index) => (
            <Card key={account.id} className="m-rise cinema-reveal" style={riseStyle(index, 8)} tilt>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                    style={{ background: `${account.color}22` }}
                  >
                    <EntityIcon value={account.icon} size={20} />
                  </span>
                  <div>
                    <div className="font-medium">{account.name}</div>
                    <div className="text-xs text-muted">初始 {formatCents(account.initialBalance)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted mb-1">当前余额</div>
                  <MoneyText cents={account.balance} className="text-lg" strong countUp />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-xs text-muted">
                <div>
                  <div>收入</div>
                  <div className="text-main mt-0.5">{formatCents(account.income)}</div>
                </div>
                <div>
                  <div>支出</div>
                  <div className="text-main mt-0.5">{formatCents(account.expense)}</div>
                </div>
                <div>
                  <div>转入</div>
                  <div className="text-main mt-0.5">{formatCents(account.transferIn)}</div>
                </div>
                <div>
                  <div>转出</div>
                  <div className="text-main mt-0.5">{formatCents(account.transferOut)}</div>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="ghost" className="h-8" onClick={() => openEdit(account)}>
                  编辑
                </Button>
                <Button type="button" variant="danger" className="h-8" onClick={() => setDeleting(account)}>
                  删除
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        title={editingId ? '编辑账户' : '新增账户'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
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
          <div className="grid grid-cols-2 gap-4">
            <Field label="账户名称">
              <Input
                value={form.name}
                placeholder="例如：微信"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label="图标（emoji）">
              <Input
                value={form.icon}
                maxLength={4}
                onChange={(event) => setForm({ ...form, icon: event.target.value })}
              />
            </Field>
          </div>
          <Field
            label="初始余额（元）"
            hint={
              balanceError ? (
                <span className="text-danger">{balanceError}</span>
              ) : (
                '只填账户当前的起始金额，后续余额会按记录自动计算；不支持负数。'
              )
            }
          >
            <div key={shakeKey} className={balanceError ? 'm-shake' : undefined}>
              <Input
                value={balanceText}
                inputMode="decimal"
                className={balanceError ? 'border-danger focus:border-danger focus:ring-danger/20' : undefined}
                onChange={(event) => {
                  setBalanceText(event.target.value.replace(/[^\d.]/g, ''))
                  if (balanceError) setBalanceError(null)
                }}
              />
            </div>
          </Field>
          <Field label="颜色">
            <div className="flex gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setForm({ ...form, color })}
                  className={`w-7 h-7 rounded-full transition ${form.color === color ? 'ring-2 ring-offset-2 ring-accent ring-offset-card' : ''}`}
                  style={{ background: color }}
                />
              ))}
            </div>
          </Field>
        </div>
      </Modal>

      {deleting ? (
        <DeleteAccountModal
          account={deleting}
          others={accounts.filter((item) => item.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDone={() => void refreshAccounts()}
        />
      ) : null}
    </div>
  )
}
