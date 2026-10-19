import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type { AccountWithBalance, AppSettings, BootstrapInfo, CategoryNode, SettingKey } from '@shared/types'

interface AppState {
  ready: boolean
  bootstrap: BootstrapInfo | null
  settings: AppSettings
  /** 在用账户（不含已归档）—— 下拉列表与合计都用它 */
  accounts: AccountWithBalance[]
  archivedAccounts: AccountWithBalance[]
  categories: CategoryNode[]
  /** 已归档的一级分类（子分类一并列出），设置/分类页用来恢复 */
  archivedCategories: CategoryNode[]
  /** 应用锁：是否处于锁定状态 */
  locked: boolean
  lock: () => void
  unlock: () => void
  load: () => Promise<void>
  initialize: (payload: { currency: string; dataDir: string; seedMode?: 'template' | 'blank' }) => Promise<void>
  refreshSettings: () => Promise<void>
  refreshAccounts: () => Promise<void>
  refreshCategories: () => Promise<void>
  setSetting: <K extends SettingKey>(key: K, value: AppSettings[K]) => Promise<void>
}

/**
 * 界面字号 → 根字号（html 的 font-size）。
 *
 * 关键：**默认档必须是 16px，也就是浏览器默认值**。
 * Tailwind 的长度全是 rem，根字号一变，整站的高度/间距/宽度会一起等比缩放。
 * 如果默认档写成 14px（那是 body 的文字大小，不是根字号），
 * 表格列宽、行高、导航条全部会缩水——这个坑已经踩过一次，被动效探针的
 * 「动效层没有挤坏表格列宽」那条断言抓了出来。
 */
export const FONT_SCALE_PX: Record<AppSettings['fontScale'], number> = {
  small: 15,
  default: 16,
  large: 18
}

export const useAppStore = create<AppState>()((set, get) => ({
  ready: false,
  bootstrap: null,
  settings: DEFAULT_SETTINGS,
  accounts: [],
  archivedAccounts: [],
  categories: [],
  archivedCategories: [],
  locked: false,

  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),

  load: async () => {
    const bootstrap = await window.api.app.bootstrap()
    // 设了 PIN 且要求启动解锁 → 先锁上
    const shouldLock = Boolean(bootstrap.settings?.lockPinHash) && (bootstrap.settings?.lockOnStart ?? true)
    set({ bootstrap, ready: true, locked: bootstrap.initialized && shouldLock })
    if (bootstrap.initialized && bootstrap.settings) {
      set({ settings: bootstrap.settings })
      await Promise.all([get().refreshAccounts(), get().refreshCategories()])
    }
  },

  initialize: async (payload) => {
    const bootstrap = await window.api.app.initialize(payload)
    set({ bootstrap })
    if (bootstrap.settings) set({ settings: bootstrap.settings })
    await Promise.all([get().refreshAccounts(), get().refreshCategories()])
  },

  refreshSettings: async () => {
    set({ settings: await window.api.settings.get() })
  },

  refreshAccounts: async () => {
    const [accounts, all] = await Promise.all([
      window.api.accounts.list(),
      window.api.accounts.list(true)
    ])
    set({ accounts, archivedAccounts: all.filter((account) => account.isArchived) })
  },

  refreshCategories: async () => {
    const [categories, all] = await Promise.all([
      window.api.categories.tree(),
      window.api.categories.tree(true)
    ])
    const archivedCategories = all
      .filter((node) => node.isArchived)
      .map((node) => ({ ...node, children: node.children.filter((child) => child.isArchived) }))
    set({ categories, archivedCategories })
  },

  setSetting: async (key, value) => {
    const settings = await window.api.settings.set(key, value)
    set({ settings })
  }
}))
