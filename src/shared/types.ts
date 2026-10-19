/** 全局共享类型：主进程与渲染进程都从这里取 */

export type RecordType = 'income' | 'expense' | 'transfer'
export type CategoryType = 'income' | 'expense'
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type BudgetPeriod = 'monthly' | 'yearly'
export type ThemeMode = 'light' | 'dark'

/** 账户 */
export interface Account {
  id: string
  name: string
  icon: string
  color: string
  /** 初始余额，单位：分 */
  initialBalance: number
  sortOrder: number
  /** 归档后不再出现在新增/编辑下拉与默认筛选里，历史记录仍显示 */
  isArchived: boolean
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

/** 账户 + 实时余额 */
export interface AccountWithBalance extends Account {
  /** 当前余额 = 初始余额 + 收 - 支 + 转入 - 转出，单位：分 */
  balance: number
  income: number
  expense: number
  transferIn: number
  transferOut: number
}

/** 分类，parentId 为空即一级分类 */
export interface Category {
  id: string
  parentId: string | null
  name: string
  icon: string
  color: string
  type: CategoryType
  sortOrder: number
  /** 归档后不再出现在选择器与筛选里，历史记录仍显示 */
  isArchived: boolean
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface CategoryNode extends Category {
  children: CategoryNode[]
}

/** 记录 */
export interface LedgerRecord {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** 金额，单位：分，恒为正数，方向由 type 决定 */
  amount: number
  type: RecordType
  /** 场景：网购 / 线下 / 饮食 … 键值可在设置里自定义 */
  channel: string
  categoryId: string | null
  accountId: string | null
  /** 仅 type = transfer 时有值 */
  toAccountId: string | null
  note: string
  /** 为空时由 note 哈希推导颜色 */
  noteColor: string | null
  tags: string[]
  createdAt: number
  updatedAt: number
}

/** 收据附件 */
export interface Attachment {
  id: string
  recordId: string
  /** 相对数据目录，如 attachments/2025/06/xxx.png */
  filePath: string
  fileName: string
  fileType: string
  fileSize: number
  createdAt: number
}

/** 列表里的记录：带展开出来的名称与附件 */
export interface RecordListItem extends LedgerRecord {
  categoryName: string | null
  categoryParentName: string | null
  accountName: string | null
  toAccountName: string | null
  deletedAt: number | null
  attachments: Attachment[]
}

/** 金额数量级档位 */
export type AmountBracket = '0-50' | '50-200' | '200-500' | '500-1000' | '1000+'

export interface RecordQuery {
  from?: string
  to?: string
  keyword?: string
  categoryIds?: string[]
  accountIds?: string[]
  types?: RecordType[]
  channels?: string[]
  amountBrackets?: AmountBracket[]
  /** 含已软删除的记录（撤销删除用） */
  includeDeleted?: boolean
  /** 只看已软删除的记录（回收站用）。与 includeDeleted 同时给时以本项为准 */
  onlyDeleted?: boolean
  limit?: number
  offset?: number
}

export interface RecordListResult {
  items: RecordListItem[]
  total: number
  /** 单位：分，仅统计 income */
  incomeTotal: number
  /** 单位：分，仅统计 expense */
  expenseTotal: number
  /** 单位：分，仅统计 transfer（不计入收支口径） */
  transferTotal: number
}

export interface RecordInput {
  date: string
  amount: number
  type: RecordType
  channel: string
  categoryId: string | null
  accountId: string | null
  toAccountId: string | null
  note: string
  noteColor: string | null
  tags: string[]
}

export interface AccountInput {
  name: string
  icon: string
  color: string
  initialBalance: number
  sortOrder?: number
}

export interface CategoryInput {
  name: string
  icon: string
  color: string
  type: CategoryType
  parentId: string | null
  sortOrder?: number
}

/** 记录场景（可自定义） */
export interface ChannelDef {
  key: string
  label: string
  icon: string
}

/**
 * 动效强度：
 *  - showcase 炫技档（默认）：环境光斑、滚动驱动揭示、3D 倾斜、View Transition 转场、主题圆形擦除
 *  - standard 标准档：只保留上一轮的克制层（时长与缓动统一、无位移特效）
 *  - minimal  极简档：几乎不动，等同于系统「减少动态效果」
 */
export type MotionLevel = 'showcase' | 'standard' | 'minimal'

/** 账单截图导入：解析出的候选记录（渲染层预览与勾选用） */
export interface BillShotCandidate {
  fingerprint: string
  date: string
  time: string
  /** 金额（分），恒为正，方向看 type */
  amount: number
  type: RecordType
  /** 截图上的分类名 */
  shotCategory: string
  /** 映射后的分类 id */
  categoryId: string | null
  merchant: string
  note: string
  /** 与库里已有记录重复 */
  duplicate: boolean
  /** 需要人工确认的原因 */
  issues: string[]
}

/** 账单截图导入：解析结果 */
export interface BillShotPreview {
  /** 选中的图片路径 */
  filePaths: string[]
  /** 顶部汇总里识别到的月份 YYYY-MM */
  month: string | null
  totalExpenseYuan: number | null
  totalIncomeYuan: number | null
  candidates: BillShotCandidate[]
  /** 逐日校验：逐笔之和 vs 截图小计 */
  reconciliation: {
    date: string
    label: string
    computedExpense: number
    computedIncome: number
    statedExpense: number | null
    statedIncome: number | null
    ok: boolean | null
  }[]
  balanced: boolean
  /** 截图分类名 → 目标分类 id（当前生效的映射） */
  categoryMapping: Record<string, string>
  warnings: string[]
}

/** 账单截图导入：入库请求 */
export interface BillShotCommitInput {
  accountId: string | null
  /** 统一打的标签，便于事后筛选/撤销 */
  tag: string
  items: {
    date: string
    amount: number
    type: RecordType
    categoryId: string | null
    note: string
    time: string
    fingerprint: string
    /** 截图上的分类名，入库成功后用来记住映射 */
    shotCategory: string
  }[]
}

export interface BillShotCommitResult {
  created: number
  /** 跳过的（与库里重复） */
  skipped: number
  ids: string[]
}

/** CSV 导入：一行（已解析成结构化字段） */
export interface CsvImportRow {
  /** 源文件里的行号，报错时指给用户看 */
  line: number
  date: string
  /** 金额（分），恒为正，方向看 type */
  amount: number
  type: RecordType
  accountName: string
  accountId: string | null
  toAccountName: string
  toAccountId: string | null
  categoryName: string
  categoryId: string | null
  channel: string
  note: string
  tags: string[]
  /** 与库里已有记录重复 */
  duplicate: boolean
  /** 需要人工确认的原因 */
  issues: string[]
}

export interface CsvImportPreview {
  fileName: string
  rows: CsvImportRow[]
  warnings: string[]
  /** 统计，给界面显示 */
  total: number
  ready: number
  duplicates: number
  problems: number
}

export interface CsvImportCommitInput {
  rows: CsvImportRow[]
  /** 分类名在库里不存在时是否自动新建（默认 false，只记到「未分类」） */
  createMissingCategories: boolean
  /** 统一用这个账户覆盖（空表示按行里的账户名匹配） */
  overrideAccountId: string | null
  /** 统一打一个标签 */
  tag: string
}

export interface CsvImportCommitResult {
  created: number
  skipped: number
  createdCategories: number
  /** 没匹配上账户而落到默认账户的行数 */
  fallbackAccount: number
}

export interface ExchangeResult {
  ok: boolean
  filePath?: string
  message?: string
  rows?: number
}

/** 统计：一级分类维度的合计 */
export interface CategoryTotal {
  categoryId: string | null
  name: string
  icon: string
  color: string
  type: 'income' | 'expense'
  total: number
  count: number
}

export interface StatsSummary {
  range: { from: string; to: string }
  income: number
  expense: number
  net: number
  count: number
  maxExpense: number
  maxIncome: number
  /** 按月汇总（当年 12 个月） */
  monthly: { month: string; income: number; expense: number }[]
  byCategory: CategoryTotal[]
}

/** 预算：categoryId 为 null 表示「总预算」；一条规则长期有效，进度按当前周期现算 */
export interface Budget {
  id: string
  categoryId: string | null
  /** 额度（分） */
  amount: number
  period: BudgetPeriod
  year: number | null
  month: number | null
  createdAt: number
  updatedAt: number
}

export interface BudgetInput {
  categoryId: string | null
  amount: number
  period: BudgetPeriod
}

/** 预算进度（BudgetPeriod 定义在文件上方） */
export interface BudgetWithProgress extends Budget {
  categoryName: string | null
  categoryParentName: string | null
  /** 当前周期已花（分） */
  spent: number
  remaining: number
  /** 已用比例，>1 表示超支 */
  ratio: number
  exceeded: boolean
  range: { from: string; to: string }
}

export interface AppSettings {
  currency: string
  showUsd: boolean
  usdRate: number
  theme: ThemeMode
  motion: MotionLevel
  /** 界面字号档位：只改根字号，Tailwind 的 rem 会跟着整体缩放 */
  fontScale: FontScale
  /** 自动备份频率：off 关闭 / daily 每天 / weekly 每周（启动时检查） */
  autoBackup: 'off' | 'daily' | 'weekly'
  /** 自动备份保留份数 */
  backupKeep: number
  /**
   * 应用锁：PIN 的哈希与盐（空哈希表示没设锁）。
   * 注意：这两项和数据库放在同一个文件里，属于「防别人随手打开」而不是「防拷走文件」，
   * 真正的加密要换 SQLCipher，见 docs 里的说明。
   */
  lockPinHash: string
  lockPinSalt: string
  /** 启动时要求解锁 */
  lockOnStart: boolean
  /** 账单截图导入：截图分类名 → 分类 id 的记忆映射 */
  billShotCategoryMap: Record<string, string>
  /** 账单截图导入：默认账户 id */
  billShotAccountId: string
  advancedMode: boolean
  autoGenerateRecurring: boolean
  channels: ChannelDef[]
  shortcuts: Record<string, string>
}

export type FontScale = 'small' | 'default' | 'large'

/** 检查更新：读一个静态 JSON 清单，比对版本号 */
export interface UpdateCheckResult {
  ok: boolean
  /** 当前版本 */
  current: string
  /** 清单里的最新版本，没有就是 null */
  latest: string | null
  hasUpdate: boolean
  /** 下载页地址（有新版本时给） */
  url: string | null
  /** 更新说明 */
  notes: string | null
  /** 失败原因（网络不通等），ok=false 时给 */
  message?: string
}

export type SettingKey = keyof AppSettings

/** 引导文件（存在 userData/config.json，独立于数据库） */
export interface AppConfig {
  initialized: boolean
  dataDir: string
}

export interface BootstrapInfo {
  initialized: boolean
  dataDir: string
  defaultDataDir: string
  dbPath: string
  appVersion: string
  electronVersion: string
  settings: AppSettings | null
}

export interface WriteResult {
  ok: boolean
  message?: string
  /** NEEDS_DECISION：需要用户选择「归档」还是「迁移并归档」 */
  code?: 'NEEDS_DECISION'
}

/** 删除账户前的现状 */
export interface AccountUsage {
  accountId: string
  recordCount: number
  recurringCount: number
  budgetCount: number
  /** 单位：分 */
  balance: number
  /** 余额为 0 且没有任何引用时才为 true */
  canHardDelete: boolean
}

/** 迁移并归档的结果 */
export interface MigrateResult extends WriteResult {
  movedRecords?: number
  movedRecurring?: number
  /** 合并后变成「自己转自己」而被软删除的转账笔数 */
  mergedTransfers?: number
  disabledRecurring?: number
  /** 分类归档时连带归档的子分类数量 */
  archivedChildren?: number
}

/** 删除分类前的现状 */
export interface CategoryUsage {
  categoryId: string
  /** 含子分类下的记录 */
  recordCount: number
  childCount: number
  canHardDelete: boolean
}

export interface AppInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  dbPath: string
  dataDir: string
  dbSizeBytes: number
}

export interface BackupResult {
  ok: boolean
  filePath?: string
  message?: string
}

/** 备份现状（设置页显示） */
export interface BackupInfo {
  dir: string
  count: number
  /** 最近一次备份时间（毫秒），没有就是 null */
  lastAt: number | null
  lastPath: string | null
  totalBytes: number
}

/** 某个时间单位上的收支合计（单位：分） */
export interface Totals {
  income: number
  expense: number
  transfer: number
  /** income − expense，转账不计入 */
  net: number
  count: number
}

/** 按天聚合的一行 */
export interface CalendarDay {
  date: string
  income: number
  expense: number
  transfer: number
  count: number
}

/** 周期规则在某个具体日期上的一次发生 */
export interface RecurringOccurrence {
  ruleId: string
  name: string
  date: string
  amount: number
  type: RecordType
  accountId: string | null
  categoryId: string | null
}

export interface CalendarSummary {
  range: { from: string; to: string }
  days: CalendarDay[]
  occurrences: RecurringOccurrence[]
}

/** 周期记账规则 */
export interface RecurringRule {
  id: string
  name: string
  /** 单位：分 */
  amount: number
  type: RecordType
  categoryId: string | null
  accountId: string | null
  toAccountId: string | null
  frequency: Frequency
  interval: number
  startDate: string
  endDate: string | null
  /** 缓存的下次记账日，不参与标记计算 */
  nextDate: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface RecurringInput {
  name: string
  amount: number
  type: RecordType
  categoryId: string | null
  accountId: string | null
  toAccountId: string | null
  frequency: Frequency
  interval: number
  startDate: string
  endDate: string | null
  enabled: boolean
}
