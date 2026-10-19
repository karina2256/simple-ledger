import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from './stores/app.store'
import { useToastStore } from './stores/toast.store'

/**
 * 全局快捷键。
 *
 * 之前设置页里能填 Ctrl+N / Ctrl+F / Ctrl+D，但**没有任何地方监听**，纯摆设。
 * 这里真正接上，并且读设置里的值（用户可以改）。
 *
 * 「新增记录」的表单状态在 RecordsPage 内部，跨组件不直接引，
 * 所以走一个自定义事件（`ledger:new-record`）——RecordsPage 监听它来开表单。
 */
export const NEW_RECORD_EVENT = 'ledger:new-record'

interface ParsedCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

/** 解析 'Ctrl+Shift+K' / 'ctrl+k' 这类写法 */
export function parseCombo(raw: string): ParsedCombo | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  const parts = text.split('+').map((part) => part.trim().toLowerCase())
  const key = parts.filter((part) => !['ctrl', 'control', 'shift', 'alt'].includes(part)).pop()
  if (!key) return null
  return {
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    key
  }
}

function matches(event: KeyboardEvent, combo: ParsedCombo | null): boolean {
  if (!combo) return false
  const key = event.key.toLowerCase()
  if (key !== combo.key) return false
  if (event.ctrlKey !== combo.ctrl) return false
  if (event.shiftKey !== combo.shift) return false
  if (event.altKey !== combo.alt) return false
  return true
}

/** 正在输入框里打字时不要抢快捷键（除了带 Ctrl 的组合，那些本来就不会输入字符） */
function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
}

/** 在 AppLayout 里调用一次就够 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const shortcuts = useAppStore.getState().settings.shortcuts ?? {}
      const theme = useAppStore.getState().settings.theme
      const setSetting = useAppStore.getState().setSetting

      if (matches(event, parseCombo(shortcuts['theme:toggle'] ?? 'Ctrl+D'))) {
        event.preventDefault()
        void setSetting('theme', theme === 'dark' ? 'light' : 'dark')
        return
      }

      if (matches(event, parseCombo(shortcuts['search:focus'] ?? 'Ctrl+F'))) {
        event.preventDefault()
        navigate('/search')
        return
      }

      if (matches(event, parseCombo(shortcuts['record:new'] ?? 'Ctrl+N'))) {
        event.preventDefault()
        navigate('/records')
        // 等路由切过去再通知，避免事件先于 RecordsPage 挂载
        window.setTimeout(() => window.dispatchEvent(new CustomEvent(NEW_RECORD_EVENT)), 60)
        return
      }

      // Esc：在搜索页之外按 Esc 时给个提示（不抢弹窗自己的 Esc 处理）
      if (event.key === 'Escape' && isTyping(event.target)) {
        ;(event.target as HTMLElement).blur()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])
}

/** 提示用户快捷键确实生效了（开发期辅助，正式版不打扰） */
export function shortcutToast(message: string): void {
  useToastStore.getState().push(message, 'info')
}
