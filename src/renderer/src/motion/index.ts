import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'

/**
 * 动效基础模块（零依赖）。
 *
 * 约定：所有动画都走 CSS 变量与 keyframes（见 styles/index.css 的「动效层」），
 * 这里只放 CSS 表达不了的两件事：
 *   1. 系统「减少动态效果」偏好的读取（JS 侧用来自动关掉数字滚动等）；
 *   2. 金额滚动这类逐帧数值缓动。
 *
 * 谁要改动画，先改 index.css 里的 --m-* 变量，不要在组件里写死 ms 和 curve。
 */

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

/** 同步读取一次系统偏好（首帧就要用它决定初始值，不能等 effect） */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCE_QUERY).matches
}

/** 跟随系统偏好变化：用户在 Windows 里打开「减少动画」时立刻生效 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(REDUCE_QUERY)
    const onChange = (): void => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}

interface CountUpOptions {
  /** 缓动时长；默认 420ms（金额是这个应用里最重要的数字，比普通卡片稍慢一点） */
  duration?: number
  /** 关掉时直接返回目标值，不产生逐帧渲染 */
  enabled?: boolean
  /** 首次挂载是否从 0 滚上来（列表里成百上千行要关掉，页面级汇总才打开） */
  animateOnMount?: boolean
  /** 用弹簧曲线（终点带 7.5% 过冲）而不是缓出——炫技档的金额就用这个 */
  spring?: boolean
}

/**
 * 弹簧采样表，与 CSS 里的 --x-snappy 同一条曲线（stiffness 300 / damping 22，峰值 1.075）。
 * 放在 JS 里是为了让「金额滚动」和「CSS 动画」回弹手感一致。
 */
const SPRING_SAMPLES = [
  0, 0.034, 0.121, 0.239, 0.372, 0.505, 0.631, 0.744, 0.839, 0.917, 0.976, 1.02, 1.049, 1.067,
  1.074, 1.075, 1.071, 1.063, 1.054, 1.043, 1.033, 1.024, 1.016, 1.01, 1.004, 1, 1
]

function springSample(progress: number): number {
  const scaled = Math.min(1, Math.max(0, progress)) * (SPRING_SAMPLES.length - 1)
  const index = Math.floor(scaled)
  const next = Math.min(SPRING_SAMPLES.length - 1, index + 1)
  const mix = scaled - index
  return SPRING_SAMPLES[index] + (SPRING_SAMPLES[next] - SPRING_SAMPLES[index]) * mix
}

/**
 * 数字滚动：target 变化时在 duration 内缓动到目标值。
 * spring=true 时用弹簳曲线（会轻微冲过目标再回落），否则用 ease-out cubic；
 * 中途目标再次变化会从当前显示值继续，不跳数。
 */
export function useCountUp(target: number, options: CountUpOptions = {}): number {
  const { duration = 420, enabled = true, animateOnMount = false, spring = false } = options
  const reduced = usePrefersReducedMotion()
  const active = enabled && !reduced

  const [value, setValue] = useState(() => (animateOnMount && enabled ? 0 : target))
  const currentRef = useRef(animateOnMount && enabled ? 0 : target)

  useEffect(() => {
    if (!active) {
      currentRef.current = target
      setValue(target)
      return
    }

    const from = currentRef.current
    const delta = target - from
    if (delta === 0) return

    let frame = 0
    const start = performance.now()
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = spring ? springSample(progress) : 1 - Math.pow(1 - progress, 3)
      const next = Math.round(from + delta * eased)
      currentRef.current = next
      setValue(next)
      if (progress < 1) frame = requestAnimationFrame(step)
      else currentRef.current = target
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, active, spring])

  return active ? value : target
}

/**
 * 入场错峰：把列表序号换算成 .m-rise 需要的 --m-i 变量。
 * cap 是必要的刹车——30 条记录 × 26ms 会拖到 780ms，所以超过 cap 的项不再累加延迟，
 * 让整批入场总时长始终留在 500ms 以内。
 */
export function riseStyle(index: number, cap = 12): CSSProperties {
  return { '--m-i': Math.min(Math.max(index, 0), cap) } as CSSProperties
}

/**
 * 校验失败的抖动。用法固定：
 *   const { shakeKey, shake } = useShake()
 *   ...
 *   <div key={shakeKey} className={error ? 'm-shake' : undefined}><Input ... /></div>
 * key 变化会重挂载外层容器，让 CSS 动画重放；连续两次填错也能各抖一次。
 */
export function useShake(): { shakeKey: number; shake: () => void } {
  const [shakeKey, setShakeKey] = useState(0)
  return { shakeKey, shake: () => setShakeKey((key) => key + 1) }
}

/** 当前是否处于「炫技档」且系统没有要求减少动态效果 */
export function cinematicEnabled(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset['motion'] === 'showcase' && !prefersReducedMotion()
}

interface ViewTransitionLike {
  finished: Promise<void>
}

/**
 * 把一次 DOM/状态更新包进 View Transition（路由转场、日历换视图、主题擦除都走它）。
 * 必须用 flushSync 同步提交：否则浏览器在 React 提交之前就把「新状态」快照拍完了。
 */
export function withViewTransition(update: () => void): void {
  if (!cinematicEnabled() || typeof document.startViewTransition !== 'function') {
    update()
    return
  }
  document.startViewTransition(() => {
    flushSync(update)
  })
}

/**
 * 主题切换：从按钮位置扩散的圆形擦除（Apple/Google 那种「新主题从一个点晕开」）。
 * x / y 是按钮中心的视口坐标；拿不到时退化到右上角。
 */
export function startThemeWipe(x: number, y: number, apply: () => void): void {
  const root = document.documentElement
  if (!cinematicEnabled() || typeof document.startViewTransition !== 'function') {
    apply()
    return
  }
  root.style.setProperty('--wipe-x', `${Math.round(x)}px`)
  root.style.setProperty('--wipe-y', `${Math.round(y)}px`)
  root.classList.add('cinema-theme-wipe')
  const transition = document.startViewTransition(() => {
    flushSync(apply)
  }) as unknown as ViewTransitionLike
  void transition.finished.finally(() => root.classList.remove('cinema-theme-wipe'))
}

export interface TiltHandlers {
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave: () => void
}

/**
 * 光标追踪：把指针位置写成 --tilt-x / --tilt-y（3D 倾斜角度）和 --mx / --my（高光位置）。
 * 用 rAF 合并写入，避免每次 pointermove 都触发一次样式计算。
 */
export function useTilt(strength = 5): TiltHandlers {
  const frame = useRef(0)

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return {
    onPointerMove: (event) => {
      if (!cinematicEnabled()) return
      const node = event.currentTarget
      const rect = node.getBoundingClientRect()
      const nx = (event.clientX - rect.left) / rect.width - 0.5
      const ny = (event.clientY - rect.top) / rect.height - 0.5
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        node.style.setProperty('--tilt-x', (nx * strength * 2).toFixed(2))
        node.style.setProperty('--tilt-y', (ny * strength * 2).toFixed(2))
        node.style.setProperty('--mx', `${Math.round(event.clientX - rect.left)}px`)
        node.style.setProperty('--my', `${Math.round(event.clientY - rect.top)}px`)
      })
    },
    onPointerLeave: () => {
      cancelAnimationFrame(frame.current)
    }
  }
}
