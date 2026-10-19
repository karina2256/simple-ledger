import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { forwardRef, useEffect, useState } from 'react'
import { usePrefersReducedMotion, useTilt } from '../motion'
import { AppMark, Icon } from './Icon'

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger'

export function Button({
  variant = 'default',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }): JSX.Element {
  const styles: Record<ButtonVariant, string> = {
    // primary 额外挂高光扫过 + 发光，炫技档下最显眼
    primary: 'cinema-sheen cinema-glow bg-accent text-white hover:opacity-90 border border-transparent',
    default: 'cinema-sheen bg-card text-main border border-line hover:bg-soft',
    ghost: 'bg-transparent text-muted border border-transparent hover:bg-soft hover:text-main',
    danger: 'bg-transparent text-danger border border-line hover:bg-soft'
  }
  return (
    <button
      {...rest}
      className={cx(
        // m-press：按下缩到 0.93（炫技档）/ 0.97（标准档），松手由弹簧曲线收回
        'm-press inline-flex items-center justify-center gap-1.5 rounded-lg px-3 h-9 text-sm',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        styles[variant],
        className
      )}
    >
      {children}
    </button>
  )
}

/** 加载指示：旋转用 linear（位移类动效才需要缓动曲线） */
export function Spinner({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className={cx('w-3.5 h-3.5 m-spin shrink-0', className)} aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        r="7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="34 47"
      />
    </svg>
  )
}

export function Card({
  children,
  className,
  padded = true,
  style,
  tilt = false
}: {
  children: ReactNode
  className?: string
  padded?: boolean
  style?: CSSProperties
  /** 是否开启光标追踪的 3D 倾斜 + 高光（炫技档下才实际生效） */
  tilt?: boolean
}): JSX.Element {
  const tiltHandlers = useTilt()
  return (
    <div
      {...tiltHandlers}
      className={cx(
        'cinema-glass cinema-glass-sheen relative overflow-hidden border rounded-card',
        tilt && 'cinema-tilt cinema-spec',
        padded && 'p-5',
        className
      )}
      style={style}
    >
      {children}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      <span className="text-xs text-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  )
}

// 注意：这里带了 w-full——Tailwind 产出里 w-full 排在所有 w-数字 之后，
// 所以调用处想给输入框定宽必须写成 !w-40（带 ! 提升优先级），否则会被 w-full 吃掉。
const inputBase =
  'h-9 w-full rounded-lg border border-line bg-card px-3 text-sm text-main placeholder:text-muted/70 ' +
  'outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref
) {
  return <input {...rest} ref={ref} className={cx(inputBase, className)} />
})

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea {...rest} className={cx(inputBase, 'h-auto py-2 leading-6', className)} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <select {...rest} className={cx(inputBase, 'appearance-none pr-8 cursor-pointer', className)}>
      {children}
    </select>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}): JSX.Element {
  return (
    <div className={cx('inline-flex rounded-lg bg-soft p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cx(
            'm-press px-3 h-8 rounded-md text-sm',
            value === option.value ? 'bg-card text-main shadow-sm font-medium' : 'text-muted hover:text-main'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 560
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}): JSX.Element | null {
  const reduced = usePrefersReducedMotion()
  // 退场也要看得见：open 变 false 后先播 180ms 退场动画，再真正卸载。
  // （父组件若直接把 Modal 卸载掉，退场就来不及播，进场不受影响。）
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    setClosing(true)
    const timer = window.setTimeout(
      () => {
        setMounted(false)
        setClosing(false)
      },
      reduced ? 0 : 180
    )
    return () => window.clearTimeout(timer)
  }, [open, mounted, reduced])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null
  return (
    <div
      className={cx(
        // 遮罩：炫技档下把背景整体虚化掉，弹窗像浮在毛玻璃上
        'cinema-scrim fixed inset-0 z-50 flex items-center justify-center p-6',
        closing ? 'm-overlay-out' : 'm-overlay-in'
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={cx(
          // 面板：炫技档是 iOS sheet 那种「从下方弹入 + 过冲回弹」，标准档用普通位移淡入
          'cinema-glass bg-card border border-line rounded-card shadow-card w-full max-h-full flex flex-col',
          closing ? 'm-dialog-out cinema-sheet-out' : 'm-dialog-in cinema-sheet-in'
        )}
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between px-5 h-14 border-b border-line">
          <h2 className="text-base font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="m-press inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted hover:bg-soft hover:text-main"
            aria-label="关闭"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer ? <div className="px-5 py-3 border-t border-line flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Empty({ text, hint }: { text: string; hint?: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <AppMark size={40} className="mb-3 opacity-70" />
      <div className="text-sm text-main">{text}</div>
      {hint ? <div className="text-xs text-muted mt-1">{hint}</div> : null}
    </div>
  )
}

export function Hint({ children }: { children: ReactNode }): JSX.Element {
  return <p className="text-xs text-muted leading-5">{children}</p>
}
