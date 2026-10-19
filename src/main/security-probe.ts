import { existsSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { backupDir, ensureDir, getDataDir } from './paths'
import * as settingsRepo from './db/repositories/settings.repo'
import { autoBackupIfDue, backupInfo, pruneBackups } from './services/backup.service'
import { compareVersion, hashPin, verifyPin } from './services/security.service'

/** 列出备份文件（探针内部用，避免把 backup.service 的内部函数导出去） */
function listBackupFiles(): { file: string }[] {
  const dir = backupDir(getDataDir())
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.startsWith('daily-ledger-') && name.endsWith('.db'))
    .map((name) => ({ file: path.join(dir, name) }))
}

/**
 * 应用锁与版本比较自检。
 *
 * PIN 这块必须验到「盐是随机的、错 PIN 必拒、清空后必失效」——
 * 这类逻辑一旦写错，表现是「谁的 PIN 都能进」或者「正确 PIN 也进不去」，
 * 都属于用户不会立刻发现但很严重的问题。
 */
export function runSecurityProbe(): number {
  const results: { name: string; ok: boolean; detail: string }[] = []
  const check = (name: string, ok: boolean, detail: unknown): void => {
    results.push({ name, ok, detail: String(detail) })
  }

  try {
    // ---- PIN 哈希 ----
    const a = hashPin('1234')
    const b = hashPin('1234')
    check('同一个 PIN 两次哈希的盐不同', a.salt !== b.salt, `${a.salt.slice(0, 8)}… / ${b.salt.slice(0, 8)}…`)
    check('同一 PIN 因盐不同而哈希不同', a.hash !== b.hash, `${a.hash.slice(0, 12)}…`)
    check('哈希不是明文', !a.hash.includes('1234'), a.hash.slice(0, 16))
    check('正确 PIN 能通过校验', verifyPin('1234', a.hash, a.salt), '1234')
    check('错误 PIN 被拒绝', !verifyPin('1235', a.hash, a.salt), '1235')
    check('空 PIN 被拒绝', !verifyPin('', a.hash, a.salt), '（空）')
    check('哈希为空时一律拒绝', !verifyPin('1234', '', ''), '（未设锁）')
    check('哈希被篡改时被拒绝', !verifyPin('1234', 'ff'.repeat(32), a.salt), '伪造哈希')

    // ---- 与设置表的往返 ----
    settingsRepo.setMany({ lockPinHash: a.hash, lockPinSalt: a.salt })
    const stored = settingsRepo.getAll()
    check('哈希与盐都落库了', stored.lockPinHash === a.hash && stored.lockPinSalt === a.salt, 'settings 表')
    check('用落库的数据能校验通过', verifyPin('1234', stored.lockPinHash, stored.lockPinSalt), '1234')

    settingsRepo.setMany({ lockPinHash: '', lockPinSalt: '' })
    const cleared = settingsRepo.getAll()
    check('清空后锁失效', !verifyPin('1234', cleared.lockPinHash, cleared.lockPinSalt), `hash="${cleared.lockPinHash}"`)
    check('默认设置里锁是关的', cleared.lockPinHash === '' && cleared.lockOnStart === true, `lockOnStart=${cleared.lockOnStart}`)

    // ---- 字号与备份设置 ----
    check(
      '字号档位默认是 default',
      cleared.fontScale === 'default',
      String(cleared.fontScale)
    )

    // ---- 自动备份：数据安全的核心，必须有断言 ----
    // 注意：探针跑在一个全新的沙箱里，应用启动时已经按默认设置（weekly）自动备份过一次，
    // 所以这里第一步先断言「启动自动备份确实发生了」——这本身就是对启动钩子的验证。
    const dir = backupDir(getDataDir())
    ensureDir(dir)
    const startup = backupInfo()
    check(
      '启动时按设置自动备份了一次',
      startup.count >= 1 && startup.lastAt !== null && startup.totalBytes > 0,
      `${startup.count} 份 / ${startup.totalBytes} 字节`
    )

    // 从干净状态开始验到期逻辑
    for (const item of listBackupFiles()) rmSync(item.file, { force: true })
    check('清理后备份目录为空', backupInfo().count === 0, `${backupInfo().count} 份`)

    // 放两个「很旧的备份」：备份的新旧是按**文件 mtime** 判断的（不是文件名里的日期），
    // 所以必须用 utimesSync 把时间真的改到过去，否则刚写的文件会被当成刚刚备份过。
    const oldFiles = ['daily-ledger-20000101-000000.db', 'daily-ledger-20000102-000000.db']
    oldFiles.forEach((name, index) => {
      const full = path.join(dir, name)
      writeFileSync(full, 'old')
      const past = new Date(2000, 0, index + 1).getTime() / 1000
      utimesSync(full, past, past)
    })
    const before = backupInfo()
    check('旧备份能被识别出来', before.count === 2 && before.lastAt !== null, `${before.count} 份，最新 ${new Date(before.lastAt ?? 0).getFullYear()} 年`)

    const first = autoBackupIfDue('daily', 2)
    check('到期时会真的备份', first !== null && first.ok === true, first?.filePath ? path.basename(first.filePath) : '没有备份')

    // 契约：autoBackupIfDue = 备份 + 清理（保留 keep 份），所以调用后总数就该是 keep
    const afterFirst = backupInfo()
    check('备份后总数等于保留份数', afterFirst.count === 2, `${afterFirst.count} 份（keep=2）`)
    check(
      '刚生成的备份是最新的',
      afterFirst.lastAt !== null && Date.now() - afterFirst.lastAt < 60_000,
      new Date(afterFirst.lastAt ?? 0).toLocaleString('zh-CN')
    )
    check(
      '最旧的那份被清掉了',
      !existsSync(path.join(dir, oldFiles[0])),
      `${oldFiles[0]} 是否还存在：${existsSync(path.join(dir, oldFiles[0]))}`
    )

    // 单独再验一次清理函数本身：把保留数压到 1
    const pruned = pruneBackups(1)
    check('pruneBackups 会删到只剩 keep 份', pruned === 1 && backupInfo().count === 1, `清理 ${pruned} 份，剩 ${backupInfo().count} 份`)
    check('再清理也不会删过头', pruneBackups(1) === 0 && backupInfo().count === 1, `剩 ${backupInfo().count} 份`)

    const second = autoBackupIfDue('daily', 2)
    check('刚备份过不会重复备份', second === null, second === null ? '返回 null（未到期）' : '又备份了一次')
    check('关掉后完全不备份', autoBackupIfDue('off', 2) === null, 'off')

    // 收尾：把自检产生的备份删掉，别污染沙箱
    for (const item of listBackupFiles()) {
      try {
        rmSync(item.file, { force: true })
      } catch {
        /* ignore */
      }
    }
    check('自检产生的备份已清理', backupInfo().count === 0, `${backupInfo().count} 份`)

    // ---- 版本比较 ----
    check('1.1.0 > 1.0.0', compareVersion('1.1.0', '1.0.0') > 0, '1.1.0 vs 1.0.0')
    check('1.0.0 < 1.0.1', compareVersion('1.0.0', '1.0.1') < 0, '1.0.0 vs 1.0.1')
    check('相同版本相等', compareVersion('1.0.0', '1.0.0') === 0, '1.0.0 vs 1.0.0')
    check('忽略 v 前缀', compareVersion('v1.2.3', '1.2.3') === 0, 'v1.2.3 vs 1.2.3')
    check('两段式版本也能比（1.2 vs 1.2.0）', compareVersion('1.2', '1.2.0') === 0, '1.2 vs 1.2.0')
    check('10 > 9（按数值而不是字符串）', compareVersion('1.10.0', '1.9.0') > 0, '1.10.0 vs 1.9.0')
    check('带后缀的版本不炸', Number.isFinite(compareVersion('1.0.0-beta.1', '1.0.0')), '1.0.0-beta.1')
  } catch (error) {
    check('探针执行完成', false, error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
  }

  const passed = results.filter((item) => item.ok).length
  console.log(`\n===== 应用锁 / 自动备份 / 版本比较验证：${passed}/${results.length} 通过 =====`)
  for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
  return passed === results.length ? 0 : 1
}
