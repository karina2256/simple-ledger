import { Fragment, useMemo, useState } from 'react'
import { formatCents } from '@shared/money'
import type { BillShotCandidate, BillShotPreview } from '@shared/types'
import { Button, Card, Empty, Field, Hint, Input, Select, Spinner } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { todayKey } from '@shared/date'
import { useAppStore } from '../../stores/app.store'
import { toast, toastError } from '../../stores/toast.store'

/**
 * 截图记账：选图 → 解析出候选 → 人工核对 → 确认入库。
 *
 * 设计上的两条硬规则：
 *  1. 解析结果**不会**自动写库，必须点「确认导入」；
 *  2. 对不上小计、金额被遮挡、与已有记录重复的，逐条标出来，不允许静默带过；
 *     并且**默认只勾选「当天小计对得上」的完整天**——半截的截图默认不导入。
 */
interface DayGroup {
  date: string
  label: string
  /** 那天的核对结论：true 完整、false 不完整、null 无法校验 */
  ok: boolean | null
  statedExpense: number | null
  computedExpense: number
  items: BillShotCandidate[]
}

/** 按日期把候选分组，并挂上那天的核对结果 */
function dayGroups(preview: BillShotPreview): DayGroup[] {
  const byDate = new Map<string, DayGroup>()
  for (const item of preview.candidates) {
    const key = item.date || '（未识别日期）'
    if (!byDate.has(key)) {
      const recon = preview.reconciliation.find((row) => row.date === item.date)
      byDate.set(key, {
        date: item.date,
        label: recon?.label ?? key,
        ok: recon ? recon.ok : null,
        statedExpense: recon?.statedExpense ?? null,
        computedExpense: recon?.computedExpense ?? 0,
        items: []
      })
    }
    byDate.get(key)?.items.push(item)
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
}

/** 默认不勾的项：重复的 + 所属那天对不上小计的 */
function defaultSkipped(preview: BillShotPreview): string[] {
  const incompleteDates = new Set(
    preview.reconciliation.filter((row) => row.ok === false).map((row) => row.date)
  )
  const noSubtotalDates = new Set(
    preview.reconciliation.filter((row) => row.ok === null).map((row) => row.date)
  )
  return preview.candidates
    .filter(
      (item) =>
        item.duplicate ||
        item.issues.length > 0 ||
        incompleteDates.has(item.date) ||
        noSubtotalDates.has(item.date)
    )
    .map((item) => item.fingerprint)
}

export function BillShotPage(): JSX.Element {
  const accounts = useAppStore((state) => state.accounts)
  const categories = useAppStore((state) => state.categories)
  const settings = useAppStore((state) => state.settings)
  const setSetting = useAppStore((state) => state.setSetting)
  const refreshAccounts = useAppStore((state) => state.refreshAccounts)

  const [filePaths, setFilePaths] = useState<string[]>([])
  const [preview, setPreview] = useState<BillShotPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [tag, setTag] = useState('账单导入')
  const [accountId, setAccountId] = useState(settings.billShotAccountId || '')

  /** 分类下拉的选项：一级分类 + 「一级 / 二级」 */
  const categoryOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [{ value: '', label: '（不指定分类）' }]
    for (const parent of categories) {
      options.push({ value: parent.id, label: `${parent.icon} ${parent.name}` })
      for (const child of parent.children) {
        options.push({ value: child.id, label: `　${child.icon} ${parent.name} / ${child.name}` })
      }
    }
    return options
  }, [categories])

  const categoryName = (id: string | null): string => {
    if (!id) return '未指定'
    for (const parent of categories) {
      if (parent.id === id) return parent.name
      const child = parent.children.find((item) => item.id === id)
      if (child) return `${parent.name} / ${child.name}`
    }
    return '未指定'
  }

  const pick = async (): Promise<void> => {
    try {
      const picked = await window.api.billShot.pick()
      if (picked.length === 0) return
      setFilePaths(picked)
      setPreview(null)
      setOverrides({})
      setSkipped(new Set())
    } catch (error) {
      toastError(error)
    }
  }

  const analyze = async (): Promise<void> => {
    if (filePaths.length === 0) return toast('请先选择账单截图', 'warn')
    setAnalyzing(true)
    try {
      const result = await window.api.billShot.preview(filePaths)
      setPreview(result)
      // 默认策略：**只勾「小计对得上」的完整天**，重复项与不完整的天都不勾。
      // 半截的截图（比如只截到某天的一部分）永远不会被默默记进去。
      setSkipped(new Set(defaultSkipped(result)))
      setOverrides({})
      if (result.candidates.length === 0) toast('没有从截图里解析出记录', 'warn')
      else {
        const incomplete = dayGroups(result).filter((group) => group.ok !== true)
        toast(
          incomplete.length > 0
            ? `解析出 ${result.candidates.length} 笔；有 ${incomplete.length} 天对不上小计，已默认不勾`
            : `解析出 ${result.candidates.length} 笔，每天都对得上小计`,
          incomplete.length > 0 ? 'warn' : 'ok'
        )
      }
    } catch (error) {
      toastError(error)
    } finally {
      setAnalyzing(false)
    }
  }

  const selected = useMemo(
    () => (preview ? preview.candidates.filter((item) => !skipped.has(item.fingerprint)) : []),
    [preview, skipped]
  )

  /** 按天分组：同一天放在一起，并带上那天的「小计 vs 逐笔之和」核对结果 */
  const groups = useMemo(() => (preview ? dayGroups(preview) : []), [preview])

  /** 快捷筛选：只勾完整的天 / 只勾今天 */
  const selectOnly = (predicate: (group: DayGroup) => boolean): void => {
    if (!preview) return
    const next = new Set<string>()
    for (const group of groups) {
      if (predicate(group)) continue
      for (const item of group.items) next.add(item.fingerprint)
    }
    setSkipped(next)
  }

  const totals = useMemo(() => {
    let expense = 0
    let income = 0
    for (const item of selected) {
      if (item.type === 'expense') expense += item.amount
      else income += item.amount
    }
    return { expense, income }
  }, [selected])

  const commit = async (): Promise<void> => {
    if (selected.length === 0) return toast('没有勾选任何记录', 'warn')
    const missingDate = selected.filter((item) => !item.date)
    if (missingDate.length > 0) return toast(`有 ${missingDate.length} 笔没识别出日期，请先取消勾选`, 'error')

    setBusy(true)
    try {
      const result = await window.api.billShot.commit({
        accountId: accountId || null,
        tag: tag.trim(),
        items: selected.map((item) => ({
          date: item.date,
          amount: item.amount,
          type: item.type,
          categoryId: overrides[item.fingerprint] ?? item.categoryId,
          note: item.note,
          time: item.time,
          fingerprint: item.fingerprint,
          shotCategory: item.shotCategory
        }))
      })
      await refreshAccounts()
      if (accountId !== settings.billShotAccountId) await setSetting('billShotAccountId', accountId)
      toast(
        result.skipped > 0 ? `已导入 ${result.created} 笔，跳过重复 ${result.skipped} 笔` : `已导入 ${result.created} 笔`,
        'ok'
      )
      setPreview(null)
      setFilePaths([])
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (fingerprint: string): void => {
    setSkipped((current) => {
      const next = new Set(current)
      if (next.has(fingerprint)) next.delete(fingerprint)
      else next.add(fingerprint)
      return next
    })
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="cinema-page-title cinema-title text-xl font-medium">截图记账</h1>
          <p className="text-xs text-muted mt-1">
            把微信「记账本」的账单截图放进来，自动读成记录。识别结果先给你核对，确认后才写进账本。
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={() => void pick()}>
            <Icon name="billshot" size={16} /> 选择截图
          </Button>
          <Button type="button" variant="primary" disabled={analyzing || filePaths.length === 0} onClick={() => void analyze()}>
            {analyzing ? (
              <>
                <Spinner />
                分析中…
              </>
            ) : (
              '开始分析'
            )}
          </Button>
        </div>
      </div>

      {filePaths.length > 0 ? (
        <Card className="cinema-reveal mb-4" padded={false}>
          <div className="px-4 py-3 border-b border-line text-xs text-muted">
            已选 {filePaths.length} 张截图
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {filePaths.map((path) => (
              <span key={path} className="text-xs text-muted bg-soft rounded-lg px-2.5 py-1.5 max-w-[280px] truncate" title={path}>
                {path.split(/[\\/]/).pop()}
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      {preview ? (
        <>
          <Card className="cinema-reveal mb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted mb-1">识别到的月份</div>
                <div>{preview.month ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-1">截图里的总支出</div>
                <div>{preview.totalExpenseYuan === null ? '—' : `¥${preview.totalExpenseYuan.toFixed(2)}`}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-1">本次勾选合计</div>
                <div className="text-expense">支出 ¥{formatCents(totals.expense)}</div>
                <div className="text-income">收入 ¥{formatCents(totals.income)}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-1">逐日核对</div>
                <div className={preview.balanced ? 'text-ok' : 'text-warn'}>
                  {preview.balanced ? '与小计对得上' : '有对不上的天数'}
                </div>
              </div>
            </div>

            {preview.warnings.length > 0 ? (
              <div className="mt-4 rounded-xl bg-soft p-3 space-y-1">
                {preview.warnings.map((warning) => (
                  <div key={warning} className="flex items-start gap-1.5 text-xs text-warn">
                    <Icon name="alert" size={16} className="shrink-0" /> {warning}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card className="cinema-reveal mb-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="导入到账户">
                <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                  <option value="">（用默认账户）</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.icon} {account.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="统一标签" hint="方便事后筛选或撤销，留空则不打标签">
                <Input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="账单导入" />
              </Field>
            </div>
          </Card>

          {preview.candidates.length === 0 ? (
            <Card>
              <Empty text="没解析出记录" hint="确认截图是「记账本 → 明细」那一页，且没有把金额裁掉" />
            </Card>
          ) : (
            <Card padded={false} className="cinema-reveal">
              {/* 快捷筛选：一条截图里经常「一天完整、一天半截」，这里一键只留完整的天 */}
              <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted mr-1">快捷筛选</span>
                <Button type="button" variant="ghost" className="h-8" onClick={() => selectOnly((group) => group.ok === true)}>
                  只导入完整的天
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8"
                  onClick={() => selectOnly((group) => group.date === todayKey())}
                >
                  只导入今天
                </Button>
                <Button type="button" variant="ghost" className="h-8" onClick={() => setSkipped(new Set())}>
                  全选
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8"
                  onClick={() => setSkipped(new Set(preview.candidates.map((item) => item.fingerprint)))}
                >
                  全不选
                </Button>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted border-b border-line">
                    <th className="w-10 px-4 h-10" />
                    <th className="text-left font-normal px-2 h-10 w-28">日期</th>
                    <th className="text-left font-normal px-2 h-10 w-16">时间</th>
                    <th className="text-left font-normal px-2 h-10 w-20">收支</th>
                    <th className="text-left font-normal px-2 h-10">分类</th>
                    <th className="text-left font-normal px-2 h-10">备注 / 商户</th>
                    <th className="text-right font-normal px-4 h-10 w-28">金额</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => {
                    const allChecked = group.items.every((item) => !skipped.has(item.fingerprint))
                    return (
                      <Fragment key={group.date || 'unknown'}>
                        {/* 每天一个分组头：完整 ✅ / 不完整 ❌ + 差额，一眼看出哪天能记 */}
                        <tr className="bg-soft/60">
                          <td className="px-4 py-2">
                            <input
                              type="checkbox"
                              checked={allChecked}
                              onChange={() => {
                                setSkipped((current) => {
                                  const next = new Set(current)
                                  for (const item of group.items) {
                                    if (allChecked) next.add(item.fingerprint)
                                    else next.delete(item.fingerprint)
                                  }
                                  return next
                                })
                              }}
                              className="cursor-pointer"
                            />
                          </td>
                          <td colSpan={6} className="px-2 py-2">
                            <span className="font-medium">{group.label}</span>
                            <span className="text-xs text-muted ml-2">{group.items.length} 笔</span>
                            {group.ok === true ? (
                              <span className="text-xs text-ok ml-2">
                                ✅ 与小计一致（出 ¥{formatCents(group.computedExpense)}）
                              </span>
                            ) : group.ok === false ? (
                              <span className="text-xs text-warn ml-2">
                                ❌ 与小计对不上：截图写 ¥
                                {formatCents(group.statedExpense ?? 0)}，逐笔只有 ¥{formatCents(group.computedExpense)}
                                （少 ¥{formatCents(Math.abs((group.statedExpense ?? 0) - group.computedExpense))}）→ 默认不导入
                              </span>
                            ) : (
                              <span className="text-xs text-muted ml-2">无法校验（这天没有小计）→ 默认不导入</span>
                            )}
                          </td>
                        </tr>
                        {group.items.map((item) => (
                          <CandidateRow
                            key={item.fingerprint}
                            item={item}
                            checked={!skipped.has(item.fingerprint)}
                            categoryId={overrides[item.fingerprint] ?? item.categoryId}
                            categoryLabel={categoryName(overrides[item.fingerprint] ?? item.categoryId)}
                            options={categoryOptions}
                            onToggle={() => toggle(item.fingerprint)}
                            onCategory={(value) => setOverrides((current) => ({ ...current, [item.fingerprint]: value }))}
                          />
                        ))}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              <div className="px-4 py-3 border-t border-line flex items-center justify-between">
                <span className="text-xs text-muted">已勾选 {selected.length} / {preview.candidates.length} 笔</span>
                <Button type="button" variant="primary" disabled={busy || selected.length === 0} onClick={() => void commit()}>
                  {busy ? (
                    <>
                      <Spinner />
                      导入中…
                    </>
                  ) : (
                    `确认导入 ${selected.length} 笔`
                  )}
                </Button>
              </div>
            </Card>
          )}
        </>
      ) : (
        <Card className="cinema-reveal">
          <Empty
            text="还没有选择截图"
            hint="点右上角「选择截图」，选微信「记账本 → 明细」那一页的截图，可多选"
          />
          <Hint>
            <span className="block mt-3 leading-5">
              识别在本机完成，图片不会上传到任何地方。截图里带「出 / 入」小计和逐笔金额时，
              程序会先自己核对一遍「逐笔之和 = 小计」，对不上会明确告诉你哪一天对不上。
            </span>
          </Hint>
        </Card>
      )}
    </div>
  )
}

/** 单条候选：勾选、改分类、显示告警 */
function CandidateRow({
  item,
  checked,
  categoryId,
  categoryLabel,
  options,
  onToggle,
  onCategory
}: {
  item: BillShotCandidate
  checked: boolean
  categoryId: string | null
  categoryLabel: string
  options: { value: string; label: string }[]
  onToggle: () => void
  onCategory: (value: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  return (
    <tr
      className={`m-rise cinema-row border-b border-line last:border-0 ${checked ? '' : 'opacity-45'}`}
    >
      <td className="px-4 py-2.5">
        <input type="checkbox" checked={checked} onChange={onToggle} className="cursor-pointer" />
      </td>
      <td className="px-2 py-2.5 text-muted">{item.date || '—'}</td>
      <td className="px-2 py-2.5 text-muted">{item.time || '—'}</td>
      <td className="px-2 py-2.5">
        <span className={item.type === 'income' ? 'text-income' : 'text-expense'}>
          {item.type === 'income' ? '入账' : '支出'}
        </span>
      </td>
      <td className="px-2 py-2.5">
        {editing ? (
          <Select
            autoFocus
            value={categoryId ?? ''}
            className="!w-52"
            onChange={(event) => {
              onCategory(event.target.value)
              setEditing(false)
            }}
            onBlur={() => setEditing(false)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="m-press rounded px-1.5 py-0.5 hover:bg-soft"
            title="点一下改分类"
          >
            {categoryLabel}
            {item.shotCategory ? <span className="text-xs text-muted ml-1.5">来自「{item.shotCategory}」</span> : null}
          </button>
        )}
      </td>
      <td className="px-2 py-2.5">
        <span>{item.note || '—'}</span>
        {item.issues.length > 0 ? (
          <span className="block text-xs text-warn mt-0.5">{item.issues.join('；')}</span>
        ) : null}
      </td>
      <td className="px-2 py-2.5 text-right">
        <span className={item.type === 'income' ? 'text-income' : 'text-expense'} >
          {item.type === 'income' ? '+' : '-'}¥{formatCents(item.amount)}
        </span>
      </td>
    </tr>
  )
}
