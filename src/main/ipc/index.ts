import { registerAppIpc } from './app'
import { registerSettingsIpc } from './settings'
import { registerAccountsIpc } from './accounts'
import { registerCategoriesIpc } from './categories'
import { registerRecordsIpc } from './records'
import { registerAttachmentsIpc } from './attachments'
import { registerCalendarIpc } from './calendar'
import { registerRecurringIpc } from './recurring'
import { registerBillShotIpc } from './billshot'
import { registerExchangeIpc } from './exchange'
import { registerStatsIpc } from './stats'
import { registerBudgetsIpc } from './budgets'
import { registerSecurityIpc } from './security'

/** 所有 IPC 通道只在这里注册一次 */
export function registerAllIpc(): void {
  registerAppIpc()
  registerSettingsIpc()
  registerAccountsIpc()
  registerCategoriesIpc()
  registerRecordsIpc()
  registerAttachmentsIpc()
  registerCalendarIpc()
  registerRecurringIpc()
  registerBillShotIpc()
  registerExchangeIpc()
  registerStatsIpc()
  registerBudgetsIpc()
  registerSecurityIpc()
}
