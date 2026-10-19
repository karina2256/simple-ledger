import { useEffect, useState } from 'react'
import { Button, Card, Field, Segmented, Select } from '../../components/ui'
import { AppMark, Icon } from '../../components/Icon'
import { useAppStore } from '../../stores/app.store'
import { toastError } from '../../stores/toast.store'

/** 起始账本：预设模板（账户+常用分类）或空白（只有一个「现金」） */
type SeedMode = 'template' | 'blank'

export function OnboardingPage(): JSX.Element {
  const bootstrap = useAppStore((state) => state.bootstrap)
  const initialize = useAppStore((state) => state.initialize)

  const [step, setStep] = useState(0)
  const [currency, setCurrency] = useState('CNY')
  const [dataDir, setDataDir] = useState('')
  const [seedMode, setSeedMode] = useState<SeedMode>('template')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (bootstrap?.defaultDataDir) setDataDir(bootstrap.defaultDataDir)
  }, [bootstrap?.defaultDataDir])

  const chooseDir = async (): Promise<void> => {
    try {
      const picked = await window.api.app.chooseDataDir()
      if (picked) setDataDir(picked)
    } catch (error) {
      toastError(error)
    }
  }

  const finish = async (): Promise<void> => {
    setBusy(true)
    try {
      await initialize({ currency, dataDir, seedMode })
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center p-8">
      {/* 首启页面也铺一层环境渐变：第一眼的观感同样是产品的一部分 */}
      <div className="cinema-ambient" aria-hidden="true">
        <span className="cinema-blob cinema-blob--a" />
        <span className="cinema-blob cinema-blob--b" />
        <span className="cinema-blob cinema-blob--c" />
      </div>
      <Card className="cinema-reveal w-full max-w-xl" padded={false} tilt>
        <div className="p-7">
          <div className="flex items-center gap-3 mb-6">
            <AppMark size={40} />
            <div>
              <h1 className="cinema-page-title text-lg font-medium">记账簿</h1>
              <p className="text-xs text-muted">本地存储 · 不联网 · 断网可用</p>
            </div>
          </div>

          {step === 0 ? (
            <div className="space-y-3">
              <h2 className="text-base font-medium">欢迎使用</h2>
              <p className="text-sm text-muted leading-6">
                所有数据都保存在你自己的电脑上，不上传、不需要网络。接下来只有两步：选一个默认币种，
                再选一个存放数据的位置。之后随时可以在设置里修改。
              </p>
              {/* 明确告诉用户这是全新账本：避免把「预设分类」误会成别人的历史数据 */}
              <div className="flex items-start gap-2 rounded-xl bg-soft p-3 text-xs text-muted leading-5">
                <Icon name="info" size={16} className="mt-0.5 shrink-0" />
                <span>这是一个<strong className="text-main">全新账本</strong>，没有任何历史记录。下面这步决定初始内容，之后都能自己改。</span>
              </div>
              <Field label="初始账本">
                <Segmented
                  value={seedMode}
                  onChange={(value) => setSeedMode(value)}
                  options={[
                    { value: 'template', label: '预设模板' },
                    { value: 'blank', label: '从空白开始' }
                  ]}
                />
              </Field>
              <p className="text-xs text-muted leading-5">
                {seedMode === 'template'
                  ? '预设模板：微信、支付宝两个账户 + 餐饮/交通/购物等 55 个常用分类，适合马上开始记。'
                  : '从空白开始：只建一个「现金」账户，分类由你自己加，适合想完全自定义的人。'}
              </p>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <h2 className="text-base font-medium">选择默认币种</h2>
              <Field label="主币种">
                <Select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                  <option value="CNY">人民币（CNY · ¥）</option>
                  <option value="USD">美元（USD · $）</option>
                </Select>
              </Field>
              <p className="text-xs text-muted leading-5">
                默认只显示人民币。如果需要同时看到美元，可以在「设置 → 币种」里开启并手动填写汇率。
              </p>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <h2 className="text-base font-medium">选择数据存储位置</h2>
              <Field label="数据目录" hint="数据库、收据图片和备份都会放在这个目录里。">
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={dataDir}
                    className="h-9 flex-1 rounded-lg border border-line bg-soft px-3 text-sm text-main outline-none"
                  />
                  <Button type="button" onClick={() => void chooseDir()}>
                    选择文件夹
                  </Button>
                </div>
              </Field>
              <p className="text-xs text-muted leading-5">
                建议放在非系统盘，或者你平时会一并备份的目录里。数据目录里的 daily-ledger.db 就是全部记录。
              </p>
            </div>
          ) : null}
        </div>

        <div className="px-7 py-4 border-t border-line flex items-center justify-between">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className={`h-1.5 rounded-full transition-all ${index === step ? 'w-6 bg-accent' : 'w-1.5 bg-line'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 ? (
              <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
                上一步
              </Button>
            ) : null}
            {step < 2 ? (
              <Button type="button" variant="primary" onClick={() => setStep(step + 1)}>
                下一步
              </Button>
            ) : (
              <Button type="button" variant="primary" disabled={busy || !dataDir} onClick={() => void finish()}>
                {busy ? '正在初始化…' : '开始使用'}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
