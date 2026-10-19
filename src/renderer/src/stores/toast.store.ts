import { create } from 'zustand'

export type ToastTone = 'info' | 'ok' | 'warn' | 'error'

export interface ToastAction {
  label: string
  run: () => void | Promise<void>
}

export interface ToastItem {
  id: string
  message: string
  tone: ToastTone
  action?: ToastAction
}

interface ToastState {
  items: ToastItem[]
  push: (message: string, tone?: ToastTone, action?: ToastAction, duration?: number) => void
  dismiss: (id: string) => void
}

let seed = 0

export const useToastStore = create<ToastState>()((set, get) => ({
  items: [],
  push: (message, tone = 'info', action, duration) => {
    const id = `t${++seed}`
    set({ items: [...get().items, { id, message, tone, action }] })
    const ttl = duration ?? (action ? 8000 : 3200)
    window.setTimeout(() => get().dismiss(id), ttl)
  },
  dismiss: (id) => set({ items: get().items.filter((item) => item.id !== id) })
}))

/** IPC 抛出来的错误统一在这里转成人话 */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}

export function toast(message: string, tone: ToastTone = 'info', action?: ToastAction): void {
  useToastStore.getState().push(message, tone, action)
}

export function toastError(error: unknown): void {
  useToastStore.getState().push(errorMessage(error), 'error')
}
