import type {
  Account,
  AccountInput,
  AccountUsage,
  AccountWithBalance,
  AppInfo,
  AppSettings,
  Attachment,
  BackupInfo,
  BackupResult,
  BillShotCommitInput,
  BillShotCommitResult,
  BillShotPreview,
  BootstrapInfo,
  Budget,
  BudgetInput,
  BudgetWithProgress,
  CalendarSummary,
  Category,
  CategoryInput,
  CategoryNode,
  CategoryUsage,
  CsvImportCommitInput,
  CsvImportCommitResult,
  CsvImportPreview,
  ExchangeResult,
  LedgerRecord,
  MigrateResult,
  RecordInput,
  RecordListItem,
  RecordListResult,
  RecordQuery,
  RecurringInput,
  RecurringRule,
  SettingKey,
  StatsSummary,
  UpdateCheckResult,
  WriteResult
} from './types'

/** IPC 通道名。主进程注册与 preload 暴露都引用这里，避免手写字符串对不上 */
export const IPC = {
  appBootstrap: 'app:bootstrap',
  appInitialize: 'app:initialize',
  appChooseDataDir: 'app:choose-data-dir',
  appOpenDataDir: 'app:open-data-dir',
  appInfo: 'app:info',
  appBackup: 'app:backup',
  appBackupInfo: 'app:backup-info',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',

  accountsList: 'accounts:list',
  accountsListArchived: 'accounts:list-archived',
  accountsCreate: 'accounts:create',
  accountsUpdate: 'accounts:update',
  accountsRemove: 'accounts:remove',
  accountsUsage: 'accounts:usage',
  accountsArchive: 'accounts:archive',
  accountsRestore: 'accounts:restore',
  accountsMigrate: 'accounts:migrate',

  categoriesTree: 'categories:tree',
  categoriesCreate: 'categories:create',
  categoriesUpdate: 'categories:update',
  categoriesRemove: 'categories:remove',
  categoriesUsage: 'categories:usage',
  categoriesArchive: 'categories:archive',
  categoriesRestore: 'categories:restore',
  categoriesMigrate: 'categories:migrate',

  recordsList: 'records:list',
  recordsCreate: 'records:create',
  recordsUpdate: 'records:update',
  recordsRemove: 'records:remove',
  recordsRestore: 'records:restore',
  recordsPurge: 'records:purge',
  recordsGet: 'records:get',

  calendarSummary: 'calendar:summary',

  recurringList: 'recurring:list',
  recurringCreate: 'recurring:create',
  recurringUpdate: 'recurring:update',
  recurringRemove: 'recurring:remove',
  recurringToggle: 'recurring:toggle',

  attachmentsPickImages: 'attachments:pick-images',
  attachmentsAdd: 'attachments:add',
  attachmentsRemove: 'attachments:remove',
  attachmentsReveal: 'attachments:reveal',

  // 账单截图导入
  billShotPick: 'billshot:pick',
  billShotPreview: 'billshot:preview',
  billShotCommit: 'billshot:commit',

  // 导入 / 导出
  exchangeExportCsv: 'exchange:export-csv',
  exchangePickCsv: 'exchange:pick-csv',
  exchangePreviewCsv: 'exchange:preview-csv',
  exchangeCommitCsv: 'exchange:commit-csv',

  // 统计汇总
  statsSummary: 'stats:summary',

  // 预算
  budgetsList: 'budgets:list',
  budgetsCreate: 'budgets:create',
  budgetsUpdate: 'budgets:update',
  budgetsRemove: 'budgets:remove',

  // 应用锁与检查更新
  securitySetPin: 'security:set-pin',
  securityClearPin: 'security:clear-pin',
  securityVerifyPin: 'security:verify-pin',
  appCheckUpdate: 'app:check-update'
} as const

/** preload 暴露给渲染进程的完整 API 契约 */
export interface Api {
  app: {
    bootstrap: () => Promise<BootstrapInfo>
    /** seedMode：template 预设账户与分类 / blank 只建一个「现金」账户 */
    initialize: (payload: { currency: string; dataDir: string; seedMode?: 'template' | 'blank' }) => Promise<BootstrapInfo>
    chooseDataDir: () => Promise<string | null>
    openDataDir: () => Promise<void>
    info: () => Promise<AppInfo>
    backup: () => Promise<BackupResult>
    /** 备份现状：上次备份时间、份数、占用 */
    backupInfo: () => Promise<BackupInfo>
    /** 便携版时返回 exe 所在目录（数据跟着 exe 走），安装版返回 null */
    portableRoot: () => Promise<string | null>
    /** 检查更新：读静态清单比对版本号 */
    checkUpdate: () => Promise<UpdateCheckResult>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: <K extends SettingKey>(key: K, value: AppSettings[K]) => Promise<AppSettings>
    reset: () => Promise<AppSettings>
  }
  accounts: {
    list: (includeArchived?: boolean) => Promise<AccountWithBalance[]>
    create: (input: AccountInput) => Promise<Account>
    update: (id: string, input: AccountInput) => Promise<Account>
    usage: (id: string) => Promise<AccountUsage>
    /** 余额为 0 且无任何引用时才真删，否则返回 NEEDS_DECISION */
    remove: (id: string) => Promise<WriteResult>
    archive: (id: string) => Promise<WriteResult>
    restore: (id: string) => Promise<WriteResult>
    migrateAndArchive: (sourceId: string, targetId: string) => Promise<MigrateResult>
  }
  categories: {
    tree: (includeArchived?: boolean) => Promise<CategoryNode[]>
    create: (input: CategoryInput) => Promise<Category>
    update: (id: string, input: CategoryInput) => Promise<Category>
    usage: (id: string) => Promise<CategoryUsage>
    /** 没有任何记录和子分类时才真删，否则返回 NEEDS_DECISION */
    remove: (id: string) => Promise<WriteResult>
    /** 归档一级分类时，其子分类一并归档 */
    archive: (id: string) => Promise<MigrateResult>
    restore: (id: string) => Promise<WriteResult>
    migrateAndArchive: (sourceId: string, targetId: string) => Promise<MigrateResult>
  }
  records: {
    list: (query: RecordQuery) => Promise<RecordListResult>
    get: (id: string) => Promise<RecordListItem | null>
    create: (input: RecordInput) => Promise<LedgerRecord>
    update: (id: string, input: RecordInput) => Promise<LedgerRecord>
    remove: (ids: string[]) => Promise<WriteResult>
    restore: (ids: string[]) => Promise<WriteResult>
    /** 彻底删除（不可撤销）；deleteAttachments 决定是否同时删掉收据文件，默认保留 */
    purge: (ids: string[], deleteAttachments: boolean) => Promise<WriteResult>
  }
  attachments: {
    pickImages: () => Promise<string[]>
    add: (recordId: string, sourcePaths: string[]) => Promise<Attachment[]>
    remove: (id: string) => Promise<WriteResult>
    reveal: (id: string) => Promise<void>
  }
  calendar: {
    summary: (range: { from: string; to: string }) => Promise<CalendarSummary>
  }
  recurring: {
    list: () => Promise<RecurringRule[]>
    create: (input: RecurringInput) => Promise<RecurringRule>
    update: (id: string, input: RecurringInput) => Promise<RecurringRule>
    remove: (id: string) => Promise<WriteResult>
    toggle: (id: string, enabled: boolean) => Promise<RecurringRule>
  }
  billShot: {
    /** 打开文件选择框，选账单截图 */
    pick: () => Promise<string[]>
    /** 解析截图，返回候选记录（不写库） */
    preview: (filePaths: string[]) => Promise<BillShotPreview>
    /** 用户确认后入库 */
    commit: (input: BillShotCommitInput) => Promise<BillShotCommitResult>
  }
  exchange: {
    /** 导出为 CSV 或 xlsx（弹保存对话框），query 决定导出范围 */
    exportTable: (query: RecordQuery, format?: 'csv' | 'xlsx') => Promise<ExchangeResult>
    /** 选择要导入的 CSV 文件 */
    pickCsv: () => Promise<string | null>
    /** 解析成预览（只读） */
    previewCsv: (filePath: string) => Promise<CsvImportPreview>
    /** 用户确认后入库 */
    commitCsv: (input: CsvImportCommitInput) => Promise<CsvImportCommitResult>
  }
  stats: {
    /** 区间内的收支与分类构成 */
    summary: (range: { from: string; to: string }) => Promise<StatsSummary>
  }
  budgets: {
    list: () => Promise<BudgetWithProgress[]>
    create: (input: BudgetInput) => Promise<Budget>
    update: (id: string, input: BudgetInput) => Promise<Budget>
    remove: (id: string) => Promise<WriteResult>
  }
  security: {
    /** 设置 / 修改 PIN（哈希在主进程算） */
    setPin: (pin: string) => Promise<WriteResult>
    /** 清除 PIN（等于关掉应用锁） */
    clearPin: () => Promise<WriteResult>
    /** 校验 PIN */
    verifyPin: (pin: string) => Promise<boolean>
  }
}
