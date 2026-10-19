import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useToastStore, type ToastItem, type ToastTone } from '../stores/toast.store'
import { Icon } from './Icon'

const TONE: Record<string, string> = {
  info: 'border-line',
  ok: 'border-ok/50',
  warn: 'border-warn/60',
  error: 'border-danger/60'
}

/** 成功时的粒子：12 颗沿圆周飞出，角度与延迟都写进 CSS 变量 */
const BURST = Array.from({ length: 12 }, (_, index) => index * 30)

/** 成功给一枚描线对勾（唯一允许过冲的地方），失败给一个不带缓动的警告图标 */
function ToneIcon({ tone }: { tone: ToastTone }): JSX.Element | null {
  if (tone === 'ok') {
    return <Icon name="check" size={20} className="m-draw shrink-0 text-ok" />
  }
  if (tone === 'error' || tone === 'warn') {
    return (
      <Icon name="alert" size={20} className={`m-pop shrink-0 ${tone === 'error' ? 'text-danger' : 'text-warn'}`} />
    )
  }
  return <Icon name="info" size={20} className="shrink-0 text-muted" />
}

/** 成功提示条额外的庆祝层：扩散光环 + 粒子爆发（炫技档才看得出来，非炫技档被压缩成瞬间） */
function Celebration(): JSX.Element {
  return (
    <>
      <span className="cinema-ring" aria-hidden="true" />
      <span className="cinema-burst" aria-hidden="true">
        {BURST.map((angle, index) => (
          <i key={angle} style={{ '--a': angle, '--bd': `${index * 14}ms` } as CSSProperties} />
        ))}
      </span>
    </>
  )
}

export function Toaster(): JSX.Element {
  const items = useToastStore((state) => state.items)
  const dismiss = useToastStore((state) => state.dismiss)

  // 退场也要看得见：store 里删掉之后，这里再多留 200ms 播完 m-toast-out
  const [leaving, setLeaving] = useState<ToastItem[]>([])
  const previous = useRef<ToastItem[]>(items)

  useEffect(() => {
    const removed = previous.current.filter((item) => !items.some((next) => next.id === item.id))
    previous.current = items
    if (removed.length === 0) return
    setLeaving((list) => [...list, ...removed])
    const timer = window.setTimeout(() => {
      setLeaving((list) => list.filter((item) => !removed.some((gone) => gone.id === item.id)))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [items])

  const rendered = [
    ...items.map((item) => ({ item, closing: false })),
    ...leaving.map((item) => ({ item, closing: true }))
  ]

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
      {rendered.map(({ item, closing }) => (
        <div
          key={item.id}
          className={[
            `cinema-glass relative pointer-events-auto flex items-center gap-2.5 rounded-xl border ${TONE[item.tone]} shadow-card px-4 py-2.5 text-sm`,
            closing ? 'm-toast-out' : item.tone === 'error' ? 'm-toast-error' : 'm-toast-in cinema-toast-in'
          ].join(' ')}
        >
          {!closing && item.tone === 'ok' ? <Celebration /> : null}
          <ToneIcon tone={item.tone} />
          <span className="text-main">{item.message}</span>
          {item.action ? (
            <button
              type="button"
              className="m-press rounded px-1 text-accent hover:underline"
              onClick={() => {
                void item.action?.run()
                dismiss(item.id)
              }}
            >
              {item.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
