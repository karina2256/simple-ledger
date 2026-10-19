import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type Api } from '@shared/ipc'
import type {
  AccountInput,
  AppSettings,
  BillShotCommitInput,
  BudgetInput,
  CategoryInput,
  CsvImportCommitInput,
  RecordInput,
  RecordQuery,
  RecurringInput,
  SettingKey
} from '@shared/types'

/** 白名单式 API：渲染进程拿不到任何 Node 能力，只能调这些方法 */
const api: Api = {
  app: {
    bootstrap: () => ipcRenderer.invoke(IPC.appBootstrap),
    initialize: (payload) => ipcRenderer.invoke(IPC.appInitialize, payload),
    chooseDataDir: () => ipcRenderer.invoke(IPC.appChooseDataDir),
    openDataDir: () => ipcRenderer.invoke(IPC.appOpenDataDir),
    info: () => ipcRenderer.invoke(IPC.appInfo),
    backup: () => ipcRenderer.invoke(IPC.appBackup),
    backupInfo: () => ipcRenderer.invoke(IPC.appBackupInfo),
    portableRoot: () => ipcRenderer.invoke('app:portable-root'),
    checkUpdate: () => ipcRenderer.invoke(IPC.appCheckUpdate)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: <K extends SettingKey>(key: K, value: AppSettings[K]) => ipcRenderer.invoke(IPC.settingsSet, key, value),
    reset: () => ipcRenderer.invoke(IPC.settingsReset)
  },
  accounts: {
    list: (includeArchived?: boolean) => ipcRenderer.invoke(IPC.accountsList, includeArchived),
    create: (input: AccountInput) => ipcRenderer.invoke(IPC.accountsCreate, input),
    update: (id: string, input: AccountInput) => ipcRenderer.invoke(IPC.accountsUpdate, id, input),
    usage: (id: string) => ipcRenderer.invoke(IPC.accountsUsage, id),
    remove: (id: string) => ipcRenderer.invoke(IPC.accountsRemove, id),
    archive: (id: string) => ipcRenderer.invoke(IPC.accountsArchive, id),
    restore: (id: string) => ipcRenderer.invoke(IPC.accountsRestore, id),
    migrateAndArchive: (sourceId: string, targetId: string) =>
      ipcRenderer.invoke(IPC.accountsMigrate, sourceId, targetId)
  },
  categories: {
    tree: (includeArchived?: boolean) => ipcRenderer.invoke(IPC.categoriesTree, includeArchived),
    create: (input: CategoryInput) => ipcRenderer.invoke(IPC.categoriesCreate, input),
    update: (id: string, input: CategoryInput) => ipcRenderer.invoke(IPC.categoriesUpdate, id, input),
    usage: (id: string) => ipcRenderer.invoke(IPC.categoriesUsage, id),
    remove: (id: string) => ipcRenderer.invoke(IPC.categoriesRemove, id),
    archive: (id: string) => ipcRenderer.invoke(IPC.categoriesArchive, id),
    restore: (id: string) => ipcRenderer.invoke(IPC.categoriesRestore, id),
    migrateAndArchive: (sourceId: string, targetId: string) =>
      ipcRenderer.invoke(IPC.categoriesMigrate, sourceId, targetId)
  },
  records: {
    list: (query: RecordQuery) => ipcRenderer.invoke(IPC.recordsList, query),
    get: (id: string) => ipcRenderer.invoke(IPC.recordsGet, id),
    create: (input: RecordInput) => ipcRenderer.invoke(IPC.recordsCreate, input),
    update: (id: string, input: RecordInput) => ipcRenderer.invoke(IPC.recordsUpdate, id, input),
    remove: (ids: string[]) => ipcRenderer.invoke(IPC.recordsRemove, ids),
    restore: (ids: string[]) => ipcRenderer.invoke(IPC.recordsRestore, ids),
    purge: (ids: string[], deleteAttachments: boolean) =>
      ipcRenderer.invoke(IPC.recordsPurge, ids, deleteAttachments)
  },
  attachments: {
    pickImages: () => ipcRenderer.invoke(IPC.attachmentsPickImages),
    add: (recordId: string, sourcePaths: string[]) => ipcRenderer.invoke(IPC.attachmentsAdd, recordId, sourcePaths),
    remove: (id: string) => ipcRenderer.invoke(IPC.attachmentsRemove, id),
    reveal: (id: string) => ipcRenderer.invoke(IPC.attachmentsReveal, id)
  },
  calendar: {
    summary: (range: { from: string; to: string }) => ipcRenderer.invoke(IPC.calendarSummary, range)
  },
  recurring: {
    list: () => ipcRenderer.invoke(IPC.recurringList),
    create: (input: RecurringInput) => ipcRenderer.invoke(IPC.recurringCreate, input),
    update: (id: string, input: RecurringInput) => ipcRenderer.invoke(IPC.recurringUpdate, id, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.recurringRemove, id),
    toggle: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.recurringToggle, id, enabled)
  },
  billShot: {
    pick: () => ipcRenderer.invoke(IPC.billShotPick),
    preview: (filePaths: string[]) => ipcRenderer.invoke(IPC.billShotPreview, filePaths),
    commit: (input: BillShotCommitInput) => ipcRenderer.invoke(IPC.billShotCommit, input)
  },
  exchange: {
    exportTable: (query: RecordQuery, format: 'csv' | 'xlsx' = 'csv') =>
      ipcRenderer.invoke(IPC.exchangeExportCsv, query, format),
    pickCsv: () => ipcRenderer.invoke(IPC.exchangePickCsv),
    previewCsv: (filePath: string) => ipcRenderer.invoke(IPC.exchangePreviewCsv, filePath),
    commitCsv: (input: CsvImportCommitInput) => ipcRenderer.invoke(IPC.exchangeCommitCsv, input)
  },
  stats: {
    summary: (range: { from: string; to: string }) => ipcRenderer.invoke(IPC.statsSummary, range)
  },
  budgets: {
    list: () => ipcRenderer.invoke(IPC.budgetsList),
    create: (input: BudgetInput) => ipcRenderer.invoke(IPC.budgetsCreate, input),
    update: (id: string, input: BudgetInput) => ipcRenderer.invoke(IPC.budgetsUpdate, id, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.budgetsRemove, id)
  },
  security: {
    setPin: (pin: string) => ipcRenderer.invoke(IPC.securitySetPin, pin),
    clearPin: () => ipcRenderer.invoke(IPC.securityClearPin),
    verifyPin: (pin: string) => ipcRenderer.invoke(IPC.securityVerifyPin, pin)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // contextIsolation 被关掉时不该发生；留个兜底避免整页白屏
  ;(globalThis as unknown as { api: Api }).api = api
}
