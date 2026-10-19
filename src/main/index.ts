import { app, dialog } from 'electron'
import { registerLedgerProtocol, registerLedgerScheme } from './protocol'
import { registerAllIpc } from './ipc'
import { createMainWindow, focusMainWindow, getMainWindow } from './window'
import { initDatabase } from './db'
import { closeDatabase, getDb, isOpen } from './db/connection'
import { backupDir, dbPath, readConfig } from './paths'
import { runSelfTest } from './selftest'
import { seedDemoData } from './demo'
import { createTray, destroyTray } from './tray'
import { runTrayProbe } from './tray-probe'
import { runPersistProbe } from './persist-probe'
import { runMotionProbe } from './motion-probe'
import { runBillShotProbe } from './billshot-probe'
import { startOcrProbe } from './ocr-probe'
import { runExchangeProbe } from './exchange-probe'
import { runSecurityProbe } from './security-probe'
import { runUpdateProbe } from './update-probe'
import { isQuitting, markQuitting } from './app-state'
import * as settingsRepo from './db/repositories/settings.repo'
import { autoBackupIfDue } from './services/backup.service'

// 必须在 app ready 之前声明自定义协议
registerLedgerScheme()

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())

  app.whenReady().then(() => {
    app.setAppUserModelId('com.dailyledger.app')
    registerLedgerProtocol()
    registerAllIpc()

    const config = readConfig()
    if (config.initialized) {
      try {
        const result = initDatabase(config.dataDir)
        if (result.integrityError) {
          throw new Error(`完整性校验未通过：${result.integrityError}`)
        }
      } catch (error) {
        dialog.showErrorBox(
          '数据库无法打开',
          [
            `数据目录：${config.dataDir}`,
            `数据库文件：${dbPath(config.dataDir)}`,
            `备份目录：${backupDir(config.dataDir)}`,
            '',
            `错误信息：${String(error instanceof Error ? error.message : error)}`
          ].join('\n')
        )
        app.quit()
        return
      }
    }

    // 启动时检查自动备份（到期才跑；崩溃/断电时退出钩子不一定跑得到，启动时留档最稳）
    if (config.initialized && isOpen()) {
      try {
        const settings = settingsRepo.getAll()
        autoBackupIfDue(settings.autoBackup ?? 'weekly', settings.backupKeep ?? 7)
      } catch (error) {
        console.error(`[backup] 自动备份检查失败：${String(error)}`)
      }
    }

    // 开发期自检：LEDGER_SELFTEST=1 时跑一遍数据层，打印结果后退出，不开界面
    if (process.env['LEDGER_SELFTEST'] === '1') {
      void runSelfTest().then((code) => {
        closeDatabase()
        app.exit(code)
      })
      return
    }

    // 只跑迁移然后退出：用来验证老版本数据库能否顺利升级
    if (process.env['LEDGER_MIGRATE_ONLY'] === '1') {      try {
        const db = getDb()
        console.log(`[migrate-only] ${dbPath(config.dataDir)}`)
        console.log(`[migrate-only] user_version = ${db.pragma('user_version', { simple: true })}`)
        console.log(`[migrate-only] foreign_key_check 异常数 = ${(db.pragma('foreign_key_check') as unknown[]).length}`)
        console.log(`[migrate-only] quick_check = ${db.pragma('quick_check', { simple: true })}`)
      } catch (error) {
        console.error(`[migrate-only] 失败：${String(error)}`)
        closeDatabase()
        app.exit(1)
        return
      }
      closeDatabase()
      app.exit(0)
      return
    }

    // 示例数据：LEDGER_SEED_DEMO=1 时写入一份示例数据然后退出
    if (process.env['LEDGER_SEED_DEMO'] === '1') {
      if (!isOpen()) {
        console.error('[seed-demo] 数据库尚未初始化，请先运行 npm run dev 完成首次启动引导')
        app.exit(1)
        return
      }
      try {
        const result = seedDemoData()
        console.log(
          `[seed-demo] ${result.seeded ? `写入 ${result.records} 笔记录、${result.rules} 条周期规则` : '已有示例数据，跳过'}`
        )
      } catch (error) {
        console.error(`[seed-demo] 失败：${String(error)}`)
        closeDatabase()
        app.exit(1)
        return
      }
      closeDatabase()
      app.exit(0)
      return
    }

    // 打包持久化自检用的初始化：建库后立刻退出（自动化验证的第一步）
    if (process.env['LEDGER_INIT_ONLY'] === '1') {
      console.log(`[init-only] 数据库就绪：${dbPath(config.dataDir)}`)
      closeDatabase()
      app.exit(0)
      return
    }

    // 账单截图导入的自检：用同版式的文本框跑完整链路（解析 → 核对 → 入库 → 去重）
    if (process.env['LEDGER_BILLSHOT_PROBE'] === '1') {
      const code = runBillShotProbe()
      closeDatabase()
      app.exit(code)
      return
    }

    // 检查更新自检：本地起一个 HTTP 服务，验正常 / 同版本 / 清单坏了 / 连不上 / 未配置
    if (process.env['LEDGER_UPDATE_PROBE'] === '1') {
      void runUpdateProbe().then((code) => {
        closeDatabase()
        app.exit(code)
      })
      return
    }

    // 应用锁与版本比较自检（PIN 哈希/盐/清空、版本号比较）
    if (process.env['LEDGER_SECURITY_PROBE'] === '1') {
      const code = runSecurityProbe()
      closeDatabase()
      app.exit(code)
      return
    }

    // 导入导出自检：写记录 → 导出 CSV → 再解析 → 再入库的往返
    if (process.env['LEDGER_EXCHANGE_PROBE'] === '1') {
      const code = runExchangeProbe()
      closeDatabase()
      app.exit(code)
      return
    }

    // OCR 全链路实测：真实截图 → 识别 → 版面 → 解析 → 逐日核对（只读）
    const ocrTarget = process.env['LEDGER_OCR_PROBE']
    if (ocrTarget) {
      startOcrProbe(ocrTarget.split(';').filter(Boolean), (code) => {
        closeDatabase()
        app.exit(code)
      })
      return
    }

    createMainWindow()
    createTray()

    // 打包后自动验证：托盘行为 / 持久化。都用环境变量触发，正常使用不会走到
    if (process.env['LEDGER_TRAY_PROBE'] === '1') {
      runTrayProbe()
      return
    }

    if (process.env['LEDGER_PERSIST_PROBE']) {
      const code = runPersistProbe(process.env['LEDGER_PERSIST_PROBE'])
      closeDatabase()
      app.exit(code)
      return
    }

    // 动效探针：把「动画挂上了、也收在终态」变成可断言的输出
    const probeWindow = getMainWindow()
    if (process.env['LEDGER_MOTION_PROBE'] === '1' && probeWindow) {
      void runMotionProbe(probeWindow).then((code) => {
        closeDatabase()
        app.exit(code)
      })
      return
    }

    app.on('activate', () => focusMainWindow())
  })

  app.on('window-all-closed', () => {
    // 有托盘常驻：窗口关掉不退出应用（窗口其实只是被隐藏了）
    if (isQuitting()) app.quit()
  })

  app.on('before-quit', () => {
    markQuitting()
    closeDatabase()
    destroyTray()
  })
}
