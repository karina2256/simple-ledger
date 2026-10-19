import { useEffect, useState } from 'react'
import { Button, Input, Spinner } from '../../components/ui'
import { AppMark, Icon } from '../../components/Icon'
import { useAppStore } from '../../stores/app.store'
import { useShake } from '../../motion'

/**
 * 应用锁：启动时（或手动锁定时）挡住整个界面，输入 PIN 才能进。
 *
 * 这是「防别人随手打开」，不是「防把数据库文件拷走」——
 * PIN 的哈希和数据库在同一个文件里，真要防拷走需要整库加密（SQLCipher）。
 */
export function LockScreen(): JSX.Element {
  const unlock = useAppStore((state) => state.unlock)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempts, setAttempts] = useState(0)
  const { shakeKey, shake } = useShake()

  // 连续输错就放慢一点，别让人无限暴力试
  const locked = attempts >= 5
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!locked) return
    setCooldown(10)
    const timer = window.setInterval(() => {
      setCooldown((value) => {
        if (value <= 1) {
          window.clearInterval(timer)
          setAttempts(0)
          return 0
        }
        return value - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [locked])

  const submit = async (): Promise<void> => {
    if (busy || locked || !pin) return
    setBusy(true)
    try {
      const ok = await window.api.security.verifyPin(pin)
      if (ok) {
        unlock()
        return
      }
      setError('PIN 不对')
      setAttempts((value) => value + 1)
      setPin('')
      shake()
    } catch {
      setError('校验失败，请重试')
      shake()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="cinema-ambient" aria-hidden="true">
        <span className="cinema-blob cinema-blob--a" />
        <span className="cinema-blob cinema-blob--b" />
        <span className="cinema-blob cinema-blob--c" />
      </div>

      <div className="cinema-glass cinema-glass-sheen cinema-reveal w-full max-w-sm rounded-card border p-7">
        <div className="flex flex-col items-center text-center mb-6">
          <AppMark size={44} />
          <div className="mt-3 font-medium">记账簿已锁定</div>
          <div className="text-xs text-muted mt-1">输入 PIN 解锁</div>
        </div>

        <div key={shakeKey} className={error ? 'm-shake' : undefined}>
          <Input
            type="password"
            autoFocus
            value={pin}
            inputMode="numeric"
            placeholder="••••"
            disabled={locked}
            className={error ? 'border-danger text-center tracking-[0.4em]' : 'text-center tracking-[0.4em]'}
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, '').slice(0, 32))
              if (error) setError('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />
        </div>

        {error || locked ? (
          <div className="flex items-center justify-center gap-1.5 text-xs text-danger mt-2">
            <Icon name="alert" size={16} />
            {locked ? `错误次数过多，请等 ${cooldown} 秒` : error}
          </div>
        ) : null}

        <Button
          type="button"
          variant="primary"
          className="w-full mt-4"
          disabled={busy || locked || !pin}
          onClick={() => void submit()}
        >
          {busy ? (
            <>
              <Spinner />
              校验中…
            </>
          ) : (
            '解锁'
          )}
        </Button>

        <p className="text-[11px] text-muted leading-4 mt-4 text-center">
          忘记 PIN 只能重装或删除数据目录里的配置；PIN 只防随手打开，数据库本身没有加密。
        </p>
      </div>
    </div>
  )
}
