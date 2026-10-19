import { useEffect, useState } from 'react'
import { formatCents } from '@shared/money'
import type { AppInfo, BackupInfo, CsvImportPreview, RecordQuery, UpdateCheckResult } from '@shared/types'
import { Button, Card, Field, Hint, Input, Modal, Segmented, Select, Spinner } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { useAppStore } from '../../stores/app.store'
import { toast, toastError } from '../../stores/toast.store'
import { useShake } from '../../motion'

function Toggle({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-10 h-6 rounded-full transition relative shrink-0 disabled:opacity-40 ${
        checked ? 'bg-accent' : 'bg-line'
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

function Row({
  title,
  desc,
  children
}: {
  title: string
  desc?: string
  children: JSX.Element
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-3 border-b border-line last:border-0">
      <div className="min-w-0">
        <div className="text-sm">{title}</div>
        {desc ? <div className="text-xs text-muted mt-0.5">{desc}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const SHORTCUT_LABEL: Record<string, string> = {
  'record:new': '新增记录',
  'search:focus': '聚焦搜索',
  'theme:toggle': '切换主题'
}

/** 快捷指令输入：本地编辑，失焦时写库，避免每敲一个字符写一次 */
function ShortcutInput({
  label,
  value,
  onCommit
}: {
  label: string
  value: string
  onCommit: (next: string) => void
}): JSX.Element {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <Field label={label}>
      <Input
        value={text}
        className="!w-48"
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== value) onCommit(text)
        }}
      />
    </Field>
  )
}

export function SettingsPage(): JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const setSetting = useAppStore((state) => state.setSetting)
  const archivedAccounts = useAppStore((state) => state.archivedAccounts)
  const accounts = useAppStore((state) => state.accounts)
  const refreshSettings = useAppStore((state) => state.refreshSettings)
  const refreshAccounts = useAppStore((state) => state.refreshAccounts)

  const [info, setInfo] = useState<AppInfo | null>(null)
  const [rate, setRate] = useState(String(settings.usdRate))
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [backing, setBacking] = useState(false)
  const [backup, setBackup] = useState<BackupInfo | null>(null)
  const [portableRoot, setPortableRoot] = useState<string | null>(null)

  // 导入 / 导出
  const [exportScope, setExportScope] = useState<'month' | 'year' | 'all'>('month')
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<CsvImportPreview | null>(null)
  const [skippedRows, setSkippedRows] = useState<Set<number>>(new Set())
  const [createMissing, setCreateMissing] = useState(false)
  const [importTag, setImportTag] = useState('CSV导入')
  const [importAccount, setImportAccount] = useState('')
  const [committing, setCommitting] = useState(false)

  // 应用锁
  const [pinOpen, setPinOpen] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const { shakeKey: pinShakeKey, shake: shakePin } = useShake()
  const hasPin = Boolean(settings.lockPinHash)
  const lock = useAppStore((state) => state.lock)

  // 检查更新
  const [checking, setChecking] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)

  const updateHint = updateResult
    ? updateResult.ok
      ? updateResult.hasUpdate
        ? `发现新版本 ${updateResult.latest}（当前 ${updateResult.current}）`
        : `已是最新版（${updateResult.current}）`
      : `检查失败：${updateResult.message ?? '未知原因'}`
    : '读一个静态清单比对版本号；没配清单地址时会提示未配置（不做静默自动升级）。'

  const doCheckUpdate = async (): Promise<void> => {
    setChecking(true)
    try {
      const result = await window.api.app.checkUpdate()
      setUpdateResult(result)
      if (result.ok && result.hasUpdate) {
        const target = result.url
        toast(
          `发现新版本 ${result.latest}`,
          'ok',
          target
            ? {
                label: '去下载',
                run: () => {
                  window.open(target, '_blank')
                }
              }
            : undefined
        )
      } else if (result.ok) {
        toast('已是最新版', 'ok')
      } else {
        toast(result.message ?? '检查失败', 'warn')
      }
    } catch (error) {
      toastError(error)
    } finally {
      setChecking(false)
    }
  }

  const savePin = async (): Promise<void> => {
    setPinError('')
    if (pinInput.length < 4) {
      setPinError('PIN 至少 4 位')
      shakePin()
      return
    }
    if (pinInput !== pinConfirm) {
      setPinError('两次输入不一致')
      shakePin()
      return
    }
    setPinBusy(true)
    try {
      const result = await window.api.security.setPin(pinInput)
      if (!result.ok) {
        setPinError(result.message ?? '设置失败')
        shakePin()
        return
      }
      await refreshSettings()
      setPinOpen(false)
      setPinInput('')
      setPinConfirm('')
      toast('应用锁已设置', 'ok')
    } catch (error) {
      toastError(error)
    } finally {
      setPinBusy(false)
    }
  }

  const clearPin = async (): Promise<void> => {
    setPinBusy(true)
    try {
      await window.api.security.clearPin()
      await refreshSettings()
      setPinOpen(false)
      toast('应用锁已关闭', 'ok')
    } catch (error) {
      toastError(error)
    } finally {
      setPinBusy(false)
    }
  }

  const refreshBackupInfo = (): void => {
    window.api.app
      .backupInfo()
      .then(setBackup)
      .catch(() => undefined)
  }

  useEffect(() => {
    window.api.app.info().then(setInfo).catch(toastError)
    refreshBackupInfo()
    window.api.app
      .portableRoot()
      .then(setPortableRoot)
      .catch(() => undefined)
  }, [])

  /** 导出范围 → RecordQuery */
  const exportQuery = (): RecordQuery => {
    const today = new Date()
    const pad = (value: number): string => String(value).padStart(2, '0')
    if (exportScope === 'all') return {}
    if (exportScope === 'year') return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` }
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    return {
      from: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`,
      to: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(last)}`
    }
  }

  const doExport = async (format: 'csv' | 'xlsx'): Promise<void> => {
    setExporting(true)
    try {
      const result = await window.api.exchange.exportTable(exportQuery(), format)
      if (!result.ok) {
        if (result.message !== '已取消') toast(result.message ?? '导出失败', 'error')
        return
      }
      toast(`已导出 ${result.rows ?? 0} 行到 ${result.filePath ?? ''}`, 'ok')
    } catch (error) {
      toastError(error)
    } finally {
      setExporting(false)
    }
  }

  const doPickImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const filePath = await window.api.exchange.pickCsv()
      if (!filePath) return
      const result = await window.api.exchange.previewCsv(filePath)
      setPreview(result)
      // 默认只勾「没问题」的行；重复行与读不出来的行默认不导入
      setSkippedRows(new Set(result.rows.filter((row) => row.issues.length > 0).map((row) => row.line)))
      setImportAccount('')
      if (result.total === 0) toast('这个文件里没有可导入的行', 'warn')
    } catch (error) {
      toastError(error)
    } finally {
      setImporting(false)
    }
  }

  const doCommitImport = async (): Promise<void> => {
    if (!preview) return
    const rows = preview.rows.filter((row) => !skippedRows.has(row.line))
    if (rows.length === 0) return toast('没有勾选任何行', 'warn')
    setCommitting(true)
    try {
      const result = await window.api.exchange.commitCsv({
        rows,
        createMissingCategories: createMissing,
        overrideAccountId: importAccount || null,
        tag: importTag.trim()
      })
      await refreshAccounts()
      toast(
        `已导入 ${result.created} 笔` +
          (result.skipped > 0 ? `，跳过 ${result.skipped} 笔` : '') +
          (result.createdCategories > 0 ? `，新建 ${result.createdCategories} 个分类` : '') +
          (result.fallbackAccount > 0 ? `，${result.fallbackAccount} 笔记到默认账户` : ''),
        'ok'
      )
      setPreview(null)
    } catch (error) {
      toastError(error)
    } finally {
      setCommitting(false)
    }
  }

  useEffect(() => {
    setRate(String(settings.usdRate))
  }, [settings.usdRate])

  const applyRate = async (): Promise<void> => {
    const value = Number(rate)
    if (!Number.isFinite(value) || value <= 0) return toast('汇率请填写大于 0 的数字', 'error')
    await setSetting('usdRate', value)
    toast('汇率已保存', 'ok')
  }

  const doBackup = async (): Promise<void> => {
    setBacking(true)
    try {
      const result = await window.api.app.backup()
      if (!result.ok) return toast(result.message ?? '备份失败', 'error')
      setLastBackup(result.filePath ?? null)
      refreshBackupInfo()
      toast('备份完成', 'ok')
    } catch (error) {
      toastError(error)
    } finally {
      setBacking(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <h1 className="cinema-page-title cinema-title text-xl font-medium">设置</h1>

      <Card>
        <h2 className="text-sm font-medium mb-1">币种</h2>
        <Row
          title="记账币种（含显示符号）"
          desc="所有金额都按这个币种存入数据库，只影响符号与格式化。切换不会换算已有数据，也不会改变金额数值。"
        >
          <Select
            value={settings.currency}
            className="!w-40"
            onChange={(event) => void setSetting('currency', event.target.value)}
          >
            <option value="CNY">人民币 CNY</option>
            <option value="USD">美元 USD</option>
          </Select>
        </Row>
        <Row
          title="附带显示折算金额"
          desc="只是按下面这个汇率「多显示一行换算结果」，不产生第二币种流水、不参与汇总。"
        >
          <Toggle checked={settings.showUsd} onChange={(value) => void setSetting('showUsd', value)} />
        </Row>
        <Row title="折算汇率" desc="手动填写，应用不联网获取汇率；汇率变化不会改动历史记录的金额。">
          <div className="flex items-center gap-2">
            <Input
              value={rate}
              inputMode="decimal"
              disabled={!settings.showUsd}
              className="!w-24"
              onChange={(event) => setRate(event.target.value.replace(/[^\d.]/g, ''))}
            />
            <Button type="button" className="h-9" disabled={!settings.showUsd} onClick={() => void applyRate()}>
              保存
            </Button>
          </div>
        </Row>
      </Card>

      <Card className="cinema-reveal">
        <h2 className="text-sm font-medium mb-1">动效</h2>
        <Row
          title="动效强度"
          desc="炫技档：环境渐变、滚动揭示、卡片 3D 倾斜、路由转场、主题圆形擦除。切档不会影响数据与功能。"
        >
          <Segmented
            value={settings.motion}
            onChange={(value) => void setSetting('motion', value)}
            options={[
              { value: 'showcase', label: '炫技' },
              { value: 'standard', label: '标准' },
              { value: 'minimal', label: '极简' }
            ]}
          />
        </Row>
        <Hint>
          系统「减少动态效果」永远优先于这里的设置；「极简」约等于系统那个开关，适合录屏或低配机器。
        </Hint>
        <Row title="界面字号" desc="只改根字号，整站等比缩放；觉得字小就把这档调大。">
          <Segmented
            value={settings.fontScale ?? 'default'}
            onChange={(value) => void setSetting('fontScale', value)}
            options={[
              { value: 'small', label: '小' },
              { value: 'default', label: '默认' },
              { value: 'large', label: '大' }
            ]}
          />
        </Row>
      </Card>

      <Card className="cinema-reveal">
        <h2 className="text-sm font-medium mb-1">数据</h2>
        <Row title="数据存储位置" desc="数据库、收据图片、备份都在这个目录里。">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted max-w-[240px] truncate" title={info?.dataDir}>
              {info?.dataDir ?? '—'}
            </span>
            <Button type="button" className="h-9" onClick={() => void window.api.app.openDataDir()}>
              打开文件夹
            </Button>
          </div>
        </Row>
        <Row
          title="数据库文件"
          desc={info ? `当前大小 ${(info.dbSizeBytes / 1024).toFixed(1)} KB` : undefined}
        >
          <span className="text-xs text-muted max-w-[320px] truncate" title={info?.dbPath}>
            {info?.dbPath ?? '—'}
          </span>
        </Row>
        <Row
          title="自动备份"
          desc={
            backup && backup.lastAt
              ? `上次备份 ${new Date(backup.lastAt).toLocaleString('zh-CN')}，共 ${backup.count} 份，占用 ${(backup.totalBytes / 1048576).toFixed(1)} MB`
              : '还没自动备份过。备份文件放进数据目录的 backup 文件夹，启动时检查是否到期。'
          }
        >
          <div className="flex items-center gap-2">
            <Segmented
              value={settings.autoBackup ?? 'weekly'}
              onChange={(value) => void setSetting('autoBackup', value)}
              options={[
                { value: 'off', label: '关闭' },
                { value: 'daily', label: '每天' },
                { value: 'weekly', label: '每周' }
              ]}
            />
            <Select
              value={String(settings.backupKeep ?? 7)}
              className="!w-28"
              disabled={(settings.autoBackup ?? 'weekly') === 'off'}
              onChange={(event) => void setSetting('backupKeep', Number(event.target.value))}
            >
              {[3, 5, 7, 14, 30].map((count) => (
                <option key={count} value={count}>
                  保留 {count} 份
                </option>
              ))}
            </Select>
          </div>
        </Row>
        <Row title="手动备份数据库" desc="随时手动留一份，和自动备份进同一个文件夹。">
          <div className="flex items-center gap-2">
            {lastBackup ? <span className="text-xs text-muted max-w-[200px] truncate">{lastBackup}</span> : null}
            <Button type="button" variant="primary" className="h-9" disabled={backing} onClick={() => void doBackup()}>
              {backing ? '备份中…' : '立即备份'}
            </Button>
          </div>
        </Row>
        {portableRoot ? (
          <Row title="便携模式" desc="检测到这是免安装版：引导文件与默认数据目录都放在 exe 同级，不会和系统里安装版的数据混在一起。">
            <span className="text-xs text-muted max-w-[280px] truncate" title={portableRoot}>
              {portableRoot}
            </span>
          </Row>
        ) : null}
      </Card>

      {/* 导入 / 导出：市场上记账软件的标配，也是「换电脑 / 对账 / 给会计」的唯一通道 */}
      <Card className="cinema-reveal">
        <h2 className="text-sm font-medium mb-1">导入 / 导出</h2>
        <Row title="导出表格" desc="Excel 是数值单元格，可直接求和；CSV 通用性最好，任何记账软件都能读。">
          <div className="flex items-center gap-2">
            <Segmented
              value={exportScope}
              onChange={(value) => setExportScope(value)}
              options={[
                { value: 'month', label: '本月' },
                { value: 'year', label: '今年' },
                { value: 'all', label: '全部' }
              ]}
            />
            <Button
              type="button"
              variant="primary"
              className="h-9"
              disabled={exporting}
              onClick={() => void doExport('xlsx')}
            >
              {exporting ? (
                <>
                  <Spinner />
                  导出中…
                </>
              ) : (
                <>
                  <Icon name="download" size={16} />
                  导出 Excel
                </>
              )}
            </Button>
            <Button type="button" className="h-9" disabled={exporting} onClick={() => void doExport('csv')}>
              <Icon name="download" size={16} />
              导出 CSV
            </Button>
          </div>
        </Row>
        <Row title="从 CSV 导入" desc="先解析成表格给你核对，确认后才写进账本；和已有记录重复的会自动跳过。">
          <Button type="button" className="h-9" disabled={importing} onClick={() => void doPickImport()}>
            {importing ? (
              <>
                <Spinner />
                解析中…
              </>
            ) : (
              <>
                <Icon name="upload" size={16} />
                选择 CSV 文件
              </>
            )}
          </Button>
        </Row>
        <Hint>
          导出文件带 UTF-8 BOM，Excel 双击不乱码；金额以「元」为单位、类型写中文，
          目的是让人能直接看懂，而不是为了程序互相读取。
        </Hint>
      </Card>

      <Card>
        <h2 className="text-sm font-medium mb-1">已归档账户</h2>
        <Hint>
          归档的账户不出现在新增 / 编辑记录的下拉与筛选里，历史记录仍然显示它的名字。恢复后重新可选。
        </Hint>
        <div className="mt-3">
          {archivedAccounts.length === 0 ? (
            <p className="text-xs text-muted py-2">暂无归档账户</p>
          ) : (
            archivedAccounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between py-2.5 border-b border-line last:border-0"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-8 h-8 rounded-lg flex items-center justify-center opacity-70"
                    style={{ background: `${account.color}22` }}
                  >
                    {account.icon}
                  </span>
                  <div>
                    <div className="text-sm">{account.name}</div>
                    <div className="text-xs text-muted">
                      余额 {formatCents(account.balance)}
                      {account.archivedAt ? ` · 归档于 ${new Date(account.archivedAt).toLocaleDateString('zh-CN')}` : ''}
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  className="h-8"
                  onClick={async () => {
                    try {
                      const result = await window.api.accounts.restore(account.id)
                      if (!result.ok) return toast(result.message ?? '恢复失败', 'warn')
                      await refreshAccounts()
                      toast('账户已恢复', 'ok')
                    } catch (error) {
                      toastError(error)
                    }
                  }}
                >
                  恢复
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-medium mb-1">快捷指令</h2>
        <Hint>支持组合键写法，例如 Ctrl+N、Alt+S。改完立即生效。</Hint>
        <div className="mt-3 space-y-3">
          {Object.keys(settings.shortcuts).map((key) => (
            <ShortcutInput
              key={key}
              label={SHORTCUT_LABEL[key] ?? key}
              value={settings.shortcuts[key] ?? ''}
              onCommit={(next) => void setSetting('shortcuts', { ...settings.shortcuts, [key]: next })}
            />
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-medium mb-1">高级操作 / 自动执行</h2>
        <Hint>这一组默认关闭。打开后才会显示清理数据等有风险的操作。</Hint>
        <div className="mt-2">
          <Row title="启用高级操作" desc="默认关闭，由你决定是否开启。">
            <Toggle
              checked={settings.advancedMode}
              onChange={async (value) => {
                await setSetting('advancedMode', value)
                if (!value && settings.autoGenerateRecurring) await setSetting('autoGenerateRecurring', false)
              }}
            />
          </Row>
          <Row title="自动生成到期的周期记账记录" desc="关闭时只做标记，不会自动写入记录。">
            <Toggle
              checked={settings.autoGenerateRecurring}
              disabled={!settings.advancedMode}
              onChange={(value) => void setSetting('autoGenerateRecurring', value)}
            />
          </Row>
          <Row title="按时间清理数据" desc="按年或自定义区间清理明细 / 全部数据（第五轮开放）。">
            <Button type="button" variant="danger" className="h-9" disabled>
              清理数据…
            </Button>
          </Row>
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-medium mb-1">安全</h2>
        <Row
          title="应用锁"
          desc={
            hasPin
              ? '已设置 PIN。锁定后需要输入 PIN 才能看到账目。'
              : '设一个 4 位以上的 PIN，别人打开你的电脑时看不到账目。'
          }
        >
          <div className="flex items-center gap-2">
            {hasPin ? (
              <>
                <Button type="button" className="h-9" onClick={() => lock()}>
                  <Icon name="eye" size={16} />
                  立即锁定
                </Button>
                <Button type="button" variant="danger" className="h-9" onClick={() => setPinOpen(true)}>
                  修改 / 清除
                </Button>
              </>
            ) : (
              <Button type="button" variant="primary" className="h-9" onClick={() => setPinOpen(true)}>
                设置 PIN
              </Button>
            )}
          </div>
        </Row>
        {hasPin ? (
          <Row title="启动时锁定" desc="关闭后开机直接进主界面，但「立即锁定」仍然可用。">
            <Toggle checked={settings.lockOnStart ?? true} onChange={(value) => void setSetting('lockOnStart', value)} />
          </Row>
        ) : null}
        <Hint>
          <strong className="text-main">说明白一点</strong>：PIN 是加盐哈希后存在数据库文件里的，
          它挡的是「别人随手打开你的电脑」，**不是**「把 daily-ledger.db 拷走也读不出」。
          要做到后者需要整库加密（SQLCipher），那要迁移现有数据库，确认要做我再动手。
        </Hint>
      </Card>

      <Card>
        <h2 className="text-sm font-medium mb-1">关于</h2>
        <div className="text-xs text-muted space-y-1 mt-2">
          <div>记账簿 v{info?.appVersion ?? '—'}</div>
          <div>
            Electron {info?.electronVersion ?? '—'} · Chromium {info?.chromeVersion ?? '—'}
          </div>
          <div>完全本地运行，不联网、不上传任何数据，断网可用。</div>
        </div>
        <Row title="检查更新" desc={updateHint}>
          <Button type="button" className="h-9" disabled={checking} onClick={() => void doCheckUpdate()}>
            {checking ? (
              <>
                <Spinner />
                检查中…
              </>
            ) : (
              <>
                <Icon name="refresh" size={16} />
                检查更新
              </>
            )}
          </Button>
        </Row>
      </Card>

      {/* CSV 导入预览：和截图记账一样，先核对、再写库 */}
      <Modal
        open={preview !== null}
        title={`导入预览 · ${preview?.fileName ?? ''}`}
        onClose={() => setPreview(null)}
        width={920}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setPreview(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={committing || !preview || preview.rows.length === skippedRows.size}
              onClick={() => void doCommitImport()}
            >
              {committing ? (
                <>
                  <Spinner />
                  导入中…
                </>
              ) : (
                `确认导入 ${preview ? preview.rows.length - skippedRows.size : 0} 行`
              )}
            </Button>
          </>
        }
      >
        {preview ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted mb-0.5">总行数</div>
                <div className="tabular-nums">{preview.total}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-0.5">可直接导入</div>
                <div className="tabular-nums text-ok">{preview.ready}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-0.5">与已有重复</div>
                <div className="tabular-nums text-warn">{preview.duplicates}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-0.5">需要处理</div>
                <div className="tabular-nums text-danger">{preview.problems}</div>
              </div>
            </div>

            {preview.warnings.length > 0 ? (
              <div className="rounded-xl bg-soft p-3 space-y-1">
                {preview.warnings.map((warning) => (
                  <div key={warning} className="flex items-start gap-1.5 text-xs text-warn">
                    <Icon name="alert" size={16} className="shrink-0" />
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-3 gap-4">
              <Field label="导入到账户" hint="留空表示按文件里的账户名列匹配；匹配不上落到默认账户">
                <Select value={importAccount} onChange={(event) => setImportAccount(event.target.value)}>
                  <option value="">（按文件里的账户名）</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.icon} {account.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="统一标签" hint="便于事后筛选或撤销">
                <Input value={importTag} onChange={(event) => setImportTag(event.target.value)} />
              </Field>
              <Field label="分类不存在时" hint="不勾选时这些记录会记为「未分类」">
                <label className="flex items-center gap-2 h-9 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createMissing}
                    onChange={(event) => setCreateMissing(event.target.checked)}
                  />
                  自动新建分类
                </label>
              </Field>
            </div>

            <div className="max-h-[340px] overflow-y-auto border border-line rounded-xl">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-xs text-muted border-b border-line">
                    <th className="w-10 px-3 h-9" />
                    <th className="text-left font-normal px-2 h-9 w-14">行</th>
                    <th className="text-left font-normal px-2 h-9 w-28">日期</th>
                    <th className="text-left font-normal px-2 h-9 w-16">类型</th>
                    <th className="text-right font-normal px-2 h-9 w-24">金额</th>
                    <th className="text-left font-normal px-2 h-9 w-24">账户</th>
                    <th className="text-left font-normal px-2 h-9 w-28">分类</th>
                    <th className="text-left font-normal px-2 h-9">备注 / 问题</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const checked = !skippedRows.has(row.line)
                    return (
                      <tr key={row.line} className={`border-b border-line last:border-0 ${checked ? '' : 'opacity-45'}`}>
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSkippedRows((current) => {
                                const next = new Set(current)
                                if (next.has(row.line)) next.delete(row.line)
                                else next.add(row.line)
                                return next
                              })
                            }
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-muted tabular-nums">{row.line}</td>
                        <td className="px-2 py-1.5">{row.date || '—'}</td>
                        <td className="px-2 py-1.5">
                          <span className={row.type === 'income' ? 'text-income' : 'text-expense'}>
                            {row.type === 'income' ? '收入' : row.type === 'expense' ? '支出' : '转账'}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          ¥{formatCents(row.amount)}
                        </td>
                        <td className="px-2 py-1.5 text-muted">{row.accountName || '（默认）'}</td>
                        <td className="px-2 py-1.5 text-muted">{row.categoryName || '未分类'}</td>
                        <td className="px-2 py-1.5">
                          <span>{row.note || '—'}</span>
                          {row.issues.length > 0 ? (
                            <span className="block text-xs text-warn mt-0.5">{row.issues.join('；')}</span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* 应用锁：设置 / 修改 / 清除 PIN */}
      <Modal
        open={pinOpen}
        title={hasPin ? '修改或清除应用锁' : '设置应用锁'}
        onClose={() => setPinOpen(false)}
        width={460}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setPinOpen(false)}>
              取消
            </Button>
            {hasPin ? (
              <Button type="button" variant="danger" disabled={pinBusy} onClick={() => void clearPin()}>
                清除 PIN
              </Button>
            ) : null}
            <Button type="button" variant="primary" disabled={pinBusy} onClick={() => void savePin()}>
              {pinBusy ? (
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
          <div key={pinShakeKey} className={pinError ? 'm-shake' : undefined}>
            <Field label="新 PIN（4–32 位数字）">
              <Input
                type="password"
                inputMode="numeric"
                autoFocus
                value={pinInput}
                className={pinError ? 'border-danger' : undefined}
                onChange={(event) => {
                  setPinInput(event.target.value.replace(/\D/g, '').slice(0, 32))
                  if (pinError) setPinError('')
                }}
              />
            </Field>
          </div>
          <Field label="再输一次">
            <Input
              type="password"
              inputMode="numeric"
              value={pinConfirm}
              onChange={(event) => {
                setPinConfirm(event.target.value.replace(/\D/g, '').slice(0, 32))
                if (pinError) setPinError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void savePin()
              }}
            />
          </Field>
          {pinError ? <div className="text-xs text-danger">{pinError}</div> : null}
          <Hint>
            PIN 忘记后无法找回：可以删掉配置里的 lockPinHash 字段重置，或直接删数据目录重来。
            修改 PIN 会立即生效；「清除 PIN」等于关掉应用锁。
          </Hint>
        </div>
      </Modal>
    </div>
  )
}
