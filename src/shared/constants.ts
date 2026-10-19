import type { AmountBracket, AppSettings, ChannelDef } from './types'

/** 备注颜色调色板：低饱和、深浅色主题下都能看 */
export const NOTE_PALETTE = [
  '#E8836B',
  '#E8A33D',
  '#C4B24A',
  '#7FBF7A',
  '#4FB3A5',
  '#4A9BD1',
  '#7B8CE0',
  '#A97BD1',
  '#D96BA8',
  '#C9895E',
  '#8A9BA8',
  '#D9767B'
] as const

/**
 * 备注 → 颜色：FNV-1a 32 位哈希后落进调色板。
 * 纯函数，主进程与渲染进程共用，保证「相同备注永远同色」。
 */
export function noteColorOf(note: string): string {
  const text = note.trim()
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return NOTE_PALETTE[hash % NOTE_PALETTE.length]
}

/** 金额数量级档位（含下限、不含上限；最后一档无上限），单位：元 */
export const AMOUNT_BRACKETS: { key: AmountBracket; label: string; min: number; max: number | null }[] = [
  { key: '0-50', label: '0 - 50', min: 0, max: 50 },
  { key: '50-200', label: '50 - 200', min: 50, max: 200 },
  { key: '200-500', label: '200 - 500', min: 200, max: 500 },
  { key: '500-1000', label: '500 - 1000', min: 500, max: 1000 },
  { key: '1000+', label: '1000 以上', min: 1000, max: null }
]

/** 默认记录场景（可自定义增删改） */
export const DEFAULT_CHANNELS: ChannelDef[] = [
  { key: 'offline', label: '线下花销', icon: '🏬' },
  { key: 'online', label: '网购消费', icon: '📦' },
  { key: 'dining', label: '饮食消费', icon: '🍜' },
  { key: 'transfer', label: '转账', icon: '🔁' },
  { key: 'other', label: '其他', icon: '📌' }
]

export const DEFAULT_SETTINGS: AppSettings = {
  currency: 'CNY',
  showUsd: false,
  usdRate: 7.2,
  theme: 'light',
  // 默认炫技档：环境光斑 + 滚动揭示 + 3D 倾斜 + 圆形擦除；嫌吵可在「设置 → 动效」里降档
  motion: 'showcase',
  // 自动备份：默认每周一次、保留 7 份；启动时检查，到期才跑
  autoBackup: 'weekly',
  backupKeep: 7,
  // 界面字号：默认档；改的是根字号，整体等比缩放
  fontScale: 'default',
  // 应用锁：默认不设（哈希为空表示没锁）
  lockPinHash: '',
  lockPinSalt: '',
  lockOnStart: true,
  // 账单截图导入：第一次导入时按名字自动映射，之后把用户改过的结果记在这里
  billShotCategoryMap: {},
  billShotAccountId: '',
  advancedMode: false,
  autoGenerateRecurring: false,
  channels: DEFAULT_CHANNELS,
  shortcuts: {
    'record:new': 'Ctrl+N',
    'search:focus': 'Ctrl+F',
    'theme:toggle': 'Ctrl+D'
  }
}

/** 预设账户 */
export const DEFAULT_ACCOUNTS = [
  { name: '微信', icon: '💬', color: '#4FB3A5', initialBalance: 0 },
  { name: '支付宝', icon: '🅰️', color: '#4A9BD1', initialBalance: 0 }
]

export interface SeedCategory {
  name: string
  icon: string
  color: string
  children: { name: string; icon: string }[]
}

export const DEFAULT_EXPENSE_CATEGORIES: SeedCategory[] = [
  {
    name: '餐饮',
    icon: '🍜',
    color: '#E8836B',
    children: [
      { name: '早餐', icon: '🥐' },
      { name: '午餐', icon: '🍚' },
      { name: '晚餐', icon: '🍲' },
      { name: '外卖', icon: '🥡' },
      { name: '零食饮料', icon: '🧋' }
    ]
  },
  {
    name: '交通',
    icon: '🚌',
    color: '#4A9BD1',
    children: [
      { name: '公交地铁', icon: '🚇' },
      { name: '打车', icon: '🚕' },
      { name: '加油', icon: '⛽' },
      { name: '停车', icon: '🅿️' }
    ]
  },
  {
    name: '购物',
    icon: '🛍️',
    color: '#D96BA8',
    children: [
      { name: '网购', icon: '📦' },
      { name: '日用', icon: '🧻' },
      { name: '服饰', icon: '👕' },
      { name: '数码', icon: '💻' }
    ]
  },
  {
    name: '居住',
    icon: '🏠',
    color: '#C9895E',
    children: [
      { name: '房租', icon: '🏢' },
      { name: '水电燃气', icon: '💡' },
      { name: '物业', icon: '🧾' },
      { name: '宽带', icon: '📶' }
    ]
  },
  {
    name: '娱乐',
    icon: '🎮',
    color: '#A97BD1',
    children: [
      { name: '影音会员', icon: '🎬' },
      { name: '游戏', icon: '🕹️' },
      { name: '旅行', icon: '✈️' },
      { name: '聚会', icon: '🍻' }
    ]
  },
  {
    name: '医疗',
    icon: '💊',
    color: '#7FBF7A',
    children: [
      { name: '挂号', icon: '🏥' },
      { name: '药品', icon: '💊' },
      { name: '体检', icon: '🩺' }
    ]
  },
  {
    name: '教育',
    icon: '📚',
    color: '#7B8CE0',
    children: [
      { name: '书籍', icon: '📖' },
      { name: '课程', icon: '🎓' },
      { name: '培训', icon: '🧑‍🏫' }
    ]
  },
  {
    name: '人情',
    icon: '🎁',
    color: '#D9767B',
    children: [
      { name: '红包', icon: '🧧' },
      { name: '礼物', icon: '🎁' },
      { name: '请客', icon: '🍽️' }
    ]
  },
  {
    name: '其他支出',
    icon: '📌',
    color: '#8A9BA8',
    children: [{ name: '未分类', icon: '❓' }]
  }
]

export const DEFAULT_INCOME_CATEGORIES: SeedCategory[] = [
  {
    name: '工资',
    icon: '💰',
    color: '#4FB3A5',
    children: [
      { name: '月薪', icon: '📅' },
      { name: '奖金', icon: '🏆' }
    ]
  },
  {
    name: '理财',
    icon: '📈',
    color: '#7FBF7A',
    children: [
      { name: '利息', icon: '🏦' },
      { name: '基金', icon: '📊' },
      { name: '股票', icon: '📉' }
    ]
  },
  {
    name: '副业',
    icon: '🧰',
    color: '#C4B24A',
    children: [{ name: '兼职', icon: '⏱️' }]
  },
  {
    name: '红包',
    icon: '🧧',
    color: '#D9767B',
    children: [{ name: '收到红包', icon: '🧧' }]
  },
  {
    name: '退款',
    icon: '↩️',
    color: '#4A9BD1',
    children: [{ name: '退款', icon: '↩️' }]
  },
  {
    name: '其他收入',
    icon: '📌',
    color: '#8A9BA8',
    children: [{ name: '未分类', icon: '❓' }]
  }
]
