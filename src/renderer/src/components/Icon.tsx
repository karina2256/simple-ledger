import type { SVGProps } from 'react'

/**
 * 图标系统（手写，不引图标库）。
 *
 * 设计约束——这些约束是为了「高级感」和「能和炫技动效搭」同时成立的：
 *  1. 24 网格、1.75 描边、圆头圆角端点：和毛玻璃/弹簧的柔和调性一致，不用尖锐直角；
 *  2. 全部 currentColor + 纯描边：选中态只加粗到 2.1，不做「描边换填充」，
 *     这样 nav 图标弹跳、pill 弹簧滑动时不会有跳变；
 *  3. 关键笔画走 45° 对角线（铅笔、箭头、叉），视觉上更锐利但不刺眼；
 *  4. 每个图标留有相同的负空间比例（内容不超出 18×18 安全区），
 *     小尺寸下不会糊成一团——emoji 那种「每个字重都不一样」的问题就来自这里。
 *
 * 尺寸只用 16 / 20 / 24 三档，跟随字号，避免出现 17px、19px 这种没对齐的尺寸。
 */
export type IconName =
  // 导航
  | 'records'
  | 'calendar'
  | 'stats'
  | 'search'
  | 'accounts'
  | 'categories'
  | 'budgets'
  | 'recurring'
  | 'billshot'
  | 'settings'
  // 界面动作
  | 'plus'
  | 'close'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'edit'
  | 'trash'
  | 'image'
  | 'folder'
  | 'download'
  | 'upload'
  | 'sparkle'
  | 'alert'
  | 'info'
  | 'sun'
  | 'moon'
  | 'filter'
  | 'refresh'
  | 'eye'
  | 'more'
  // 分类 / 账户用（把 emoji 换成设计图标）
  | 'utensils'
  | 'coffee'
  | 'bus'
  | 'bag'
  | 'home'
  | 'game'
  | 'pill'
  | 'book'
  | 'gift'
  | 'inbox'
  | 'briefcase'
  | 'chartUp'
  | 'refund'
  | 'coins'
  | 'receipt'
  | 'star'
  | 'wallet'

const PATHS: Record<IconName, JSX.Element> = {
  // ---- 导航 ----
  records: (
    <>
      <path d="M9 7h9M9 12h9M9 17h5.5" />
      <path d="M5.5 7h.01M5.5 12h.01M5.5 17h.01" />
    </>
  ),
  calendar: (
    <>
      <path d="M4.5 7.5h15v12h-15z" />
      <path d="M4.5 11.5h15M8.5 4.5v4M15.5 4.5v4" />
    </>
  ),
  stats: (
    <>
      <path d="M4 19.5h16" />
      <path d="M8 19.5v-8M12 19.5v-13M16 19.5v-5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M14.6 14.6L19 19" />
    </>
  ),
  accounts: (
    <>
      <path d="M3.5 8.5h17v9.5h-17z" />
      <path d="M3.5 8.5V7a2 2 0 0 1 2-2h10.5" />
      <path d="M16 13.2h2" />
    </>
  ),
  categories: (
    <>
      <path d="M11.4 4.5H5.6a1 1 0 0 0-1 1v5.8a1 1 0 0 0 .3.7l6 6a1 1 0 0 0 1.4 0l5.8-5.8a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-.7-.3z" />
      <path d="M8.4 8.4h.01" />
    </>
  ),
  budgets: (
    <>
      <circle cx="12" cy="12" r="7.8" />
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 12h.01" />
    </>
  ),
  recurring: (
    <>
      <path d="M18.4 8A7.2 7.2 0 0 0 5.6 11.4" />
      <path d="M5.6 16A7.2 7.2 0 0 0 18.4 12.6" />
      <path d="M18.4 4.6v3.4h-3.4M5.6 19.4V16h3.4" />
    </>
  ),
  billshot: (
    <>
      <path d="M4.5 8.8h3.2l1.5-2.1h5.6l1.5 2.1h3.2a1 1 0 0 1 1 1v8.2a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V9.8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.6" r="3.2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 8.5h9M17.5 8.5h2.5M4 15.5h5M13.5 15.5h6.5" />
      <circle cx="15.2" cy="8.5" r="2.3" />
      <circle cx="11.2" cy="15.5" r="2.3" />
    </>
  ),

  // ---- 动作 ----
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  close: <path d="M6.6 6.6l10.8 10.8M17.4 6.6L6.6 17.4" />,
  check: <path d="M5.2 12.6l4.6 4.6L19 6.9" />,
  chevronLeft: <path d="M14.5 6.5L8.5 12l6 5.5" />,
  chevronRight: <path d="M9.5 6.5l6 5.5-6 5.5" />,
  chevronDown: <path d="M6.5 9.5l5.5 6 5.5-6" />,
  edit: (
    <>
      <path d="M4.8 19.2l.9-3.6L15.9 5.4a1.6 1.6 0 0 1 2.3 0l.4.4a1.6 1.6 0 0 1 0 2.3L8.4 18.3l-3.6.9z" />
      <path d="M14.7 6.6l2.7 2.7" />
    </>
  ),
  trash: (
    <>
      <path d="M5.5 7.5h13M9.8 7.5V5.6h4.4v1.9" />
      <path d="M7.2 7.5l.7 11.9h8.2l.7-11.9" />
      <path d="M10.4 10.8v5.4M13.6 10.8v5.4" />
    </>
  ),
  image: (
    <>
      <path d="M4.5 5.5h15v13h-15z" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4.5 15.5l4.2-4 3.4 3 2.6-2.3 4.8 4.4" />
    </>
  ),
  folder: (
    <>
      <path d="M4 7.4h5.1l1.6 2.1h9.3v9.1H4z" />
      <path d="M4 7.4V6.2a1 1 0 0 1 1-1h3.4" />
    </>
  ),
  download: <path d="M12 4.5v10.8M7.6 11l4.4 4.3 4.4-4.3M4.8 19.5h14.4" />,
  upload: <path d="M12 19.5V8.7M7.6 13l4.4-4.5 4.4 4.5M4.8 4.5h14.4" />,
  sparkle: (
    <>
      <path d="M12 3.8l1.7 4.7 4.7 1.7-4.7 1.7L12 16.6l-1.7-4.7L5.6 10.2l4.7-1.7z" />
      <path d="M18.4 16.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.8v5" />
      <path d="M12 16.1h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 11.2v5" />
      <path d="M12 7.9h.01" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3.4v2M12 18.6v2M3.4 12h2M18.6 12h2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z" />,
  filter: <path d="M4.5 6.2h15l-5.9 7v5.1l-3.2 1.7v-6.8z" />,
  refresh: (
    <>
      <path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1" />
      <path d="M19.4 4.6v4h-4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6.4 6.4 12 6.4 21.2 12 21.2 12 17.6 17.6 12 17.6 2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
  more: <path d="M6.4 12h.01M12 12h.01M17.6 12h.01" />,

  // ---- 分类 / 账户 ----
  utensils: (
    <>
      <path d="M7.6 3.8v5.4a2 2 0 0 0 4 0V3.8" />
      <path d="M9.6 3.8v16.4" />
      <path d="M16.4 20.2V9.4c1.7-.4 2.6-1.7 2.6-3.3 0-1.4-.9-2.3-2.6-2.3" />
    </>
  ),
  coffee: (
    <>
      <path d="M5.4 9.4h11.2v4.8a4.4 4.4 0 0 1-4.4 4.4h-2.4a4.4 4.4 0 0 1-4.4-4.4z" />
      <path d="M16.6 10.8h1.4a2.2 2.2 0 0 1 0 4.4h-1.4" />
      <path d="M8.6 6.2V4.4M12 6.2V4.4" />
    </>
  ),
  bus: (
    <>
      <path d="M5 5.4h14v11H5z" />
      <path d="M5 11.4h14M7.8 16.4v2M16.2 16.4v2" />
      <path d="M8.4 8.6h7.2" />
    </>
  ),
  bag: (
    <>
      <path d="M5.8 8.6h12.4l1 11H4.8z" />
      <path d="M9 8.6V7a3 3 0 0 1 6 0v1.6" />
    </>
  ),
  home: (
    <>
      <path d="M4.4 10.6L12 4.4l7.6 6.2" />
      <path d="M6.4 9.9v9.7h11.2V9.9" />
      <path d="M10.4 19.6v-5.2h3.2v5.2" />
    </>
  ),
  game: (
    <>
      <path d="M8.6 7.6h6.8a5.4 5.4 0 0 1 5.4 5.4v1.6a2.8 2.8 0 0 1-5 1.7l-.9-1.2H9.1l-.9 1.2a2.8 2.8 0 0 1-5-1.7V13a5.4 5.4 0 0 1 5.4-5.4z" />
      <path d="M7.6 11.4v2.4M6.4 12.6h2.4M15.6 12h.01M17.6 13.6h.01" />
    </>
  ),
  pill: (
    <>
      <path d="M8.4 15.6l7.2-7.2a3.4 3.4 0 0 1 4.8 4.8l-7.2 7.2a3.4 3.4 0 0 1-4.8-4.8z" />
      <path d="M12 12l3.6 3.6" />
    </>
  ),
  book: (
    <>
      <path d="M12 7.4S10.2 5.6 4.8 5.6v12.2C10.2 17.8 12 19.6 12 19.6s1.8-1.8 7.2-1.8V5.6C13.8 5.6 12 7.4 12 7.4z" />
      <path d="M12 7.4v12.2" />
    </>
  ),
  gift: (
    <>
      <path d="M4.6 8.6h14.8v3H4.6zM6 11.6v8h12v-8" />
      <path d="M12 8.6v11" />
      <path d="M12 8.6S11 4.4 8.8 4.4a2.1 2.1 0 0 0 0 4.2H12zM12 8.6s1-4.2 3.2-4.2a2.1 2.1 0 0 1 0 4.2H12z" />
    </>
  ),
  inbox: (
    <>
      <path d="M4.2 12.6L6.4 5.4h11.2l2.2 7.2v6.4H4.2z" />
      <path d="M4.2 12.6h4.4l.8 2.2h5.2l.8-2.2h4.4" />
    </>
  ),
  briefcase: (
    <>
      <path d="M4.4 8.4h15.2v10.2H4.4z" />
      <path d="M9.4 8.4V6.6a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v1.8" />
      <path d="M4.4 12.6h15.2" />
    </>
  ),
  chartUp: (
    <>
      <path d="M4 19.6h16" />
      <path d="M7 15.8l3.6-4.2 2.8 2.4 4.4-5.2" />
      <path d="M14.4 8.8h4.4v4.2" />
    </>
  ),
  refund: (
    <>
      <path d="M4.8 12a7.2 7.2 0 1 0 2.1-5.1" />
      <path d="M4.6 4.6v4h4" />
      <path d="M9.4 13.4l2.6-3.2 2.6 3.2" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="9" cy="7.6" rx="4.6" ry="2.6" />
      <path d="M4.4 7.6v4c0 1.4 2.1 2.6 4.6 2.6s4.6-1.2 4.6-2.6v-4" />
      <path d="M11.2 14.2c.7 1.2 2.4 2 4.4 2 2.5 0 4.6-1.2 4.6-2.6" />
      <ellipse cx="15.6" cy="13.6" rx="4.6" ry="2.6" />
      <path d="M20.2 13.6v3.4c0 1.4-2.1 2.6-4.6 2.6-1.9 0-3.6-.7-4.3-1.7" />
    </>
  ),
  receipt: (
    <>
      <path d="M6.2 4.6h11.6v15.8l-2.2-1.5-2.2 1.5-2.2-1.5-2.2 1.5-2.8-1.5z" />
      <path d="M9 8.8h6M9 12.4h6" />
    </>
  ),
  star: (
    <path d="M12 4.4l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z" />
  ),
  wallet: (
    <>
      <path d="M3.8 8.4h16.4v10H3.8z" />
      <path d="M3.8 8.4V7a1.6 1.6 0 0 1 1.6-1.6h9.8" />
      <path d="M15.6 12.4h4.6v3.2h-4.6a1.6 1.6 0 0 1 0-3.2z" />
    </>
  )
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: 16 | 20 | 24
  /** 选中态：只加粗描边，不换填充，避免和弹簧/弹跳动效抢视觉 */
  active?: boolean
}

export function Icon({ name, size = 20, active = false, className, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.1 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}

/**
 * 应用标识：和 resources/icons/icon.ico 同一套图形语言（青绿底 + 账本页 + 三条账目线 + 橙色硬币）。
 * 原来这里是一个 🐋 emoji——emoji 是这个界面「AI 味」最大的来源，全部换成设计图形。
 */
export function AppMark({ size = 22, className }: { size?: number; className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.2" fill="var(--c-accent)" />
      <path d="M7.4 6.8h6.1l3.1 3.1v7.3H7.4z" fill="var(--c-card)" opacity="0.96" />
      <path d="M13.5 6.8v3.1h3.1" fill="none" stroke="var(--c-accent)" strokeWidth="1.2" strokeLinejoin="round" />
      <path
        d="M9.6 12.4h4.8M9.6 14.8h3.2"
        stroke="var(--c-accent)"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="16.3" cy="16.2" r="3.1" fill="#E8A33D" />
      <path d="M16.3 14.6v3.2M14.9 16.2h2.8" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * emoji → 设计图标 的映射。
 *
 * 只做「渲染期映射」，不改数据库：老数据里存的还是 emoji，渲染时换成设计图标；
 * 用户自己填的、表里没有的 emoji 原样显示，不强行替换。
 * 新选择的图标会存成 `i:xxx`，优先级最高。
 */
export const EMOJI_TO_ICON: Record<string, IconName> = {
  '🍜': 'utensils', '🍚': 'utensils', '🍲': 'utensils', '🥐': 'coffee', '🥡': 'utensils', '🧋': 'coffee',
  '🚌': 'bus', '🚇': 'bus', '🚕': 'bus', '⛽': 'bus', '🅿️': 'bus',
  '🛍️': 'bag', '📦': 'bag', '🧻': 'bag', '👕': 'bag', '💻': 'bag',
  '🏠': 'home', '🏢': 'home', '💡': 'home', '🧾': 'receipt', '📶': 'home',
  '🎮': 'game', '🎬': 'game', '🕹️': 'game', '✈️': 'game', '🍻': 'utensils',
  '💊': 'pill', '🏥': 'pill', '🩺': 'pill',
  '📚': 'book', '📖': 'book', '🎓': 'book', '🧑‍🏫': 'book',
  '🎁': 'gift', '🧧': 'gift', '🍽️': 'utensils',
  '📌': 'inbox', '❓': 'inbox',
  '💰': 'briefcase', '📅': 'briefcase', '🏆': 'star', '🧰': 'briefcase', '⏱️': 'briefcase',
  '📈': 'chartUp', '🏦': 'coins', '📊': 'chartUp', '📉': 'chartUp',
  '↩️': 'refund',
  '💬': 'wallet', '🅰️': 'wallet', '💳': 'wallet',
  '📝': 'records', '📷': 'billshot', '🏷️': 'categories', '🎯': 'budgets', '🔄': 'recurring', '⚙️': 'settings'
}

/**
 * 渲染一个「实体图标」（分类 / 账户 / 渠道）：
 *  1. `i:name` → 设计图标
 *  2. 已知 emoji → 对应设计图标
 *  3. 其它 → 原样显示用户输入
 */
export function EntityIcon({
  value,
  size = 20,
  className
}: {
  value: string
  size?: 16 | 20 | 24
  className?: string
}): JSX.Element {
  const raw = (value ?? '').trim()
  if (raw.startsWith('i:')) {
    const name = raw.slice(2) as IconName
    if (name in PATHS) return <Icon name={name} size={size} className={className} />
  }
  const mapped = EMOJI_TO_ICON[raw]
  if (mapped) return <Icon name={mapped} size={size} className={className} />
  return <span className={className}>{raw || '·'}</span>
}

/** 图标选择器用的候选列表（分类/账户共用） */
export const PICKER_ICONS: IconName[] = [
  'utensils', 'coffee', 'bus', 'bag', 'home', 'game', 'pill', 'book',
  'gift', 'inbox', 'briefcase', 'chartUp', 'refund', 'coins', 'receipt', 'star', 'wallet', 'budgets'
]
