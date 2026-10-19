import type { TextBox } from './services/billshot.extract'
import { classifyPage, extractLayout } from './services/billshot.extract'
import * as billShot from './services/billshot.service'
import * as recordsRepo from './db/repositories/records.repo'
import * as accountsRepo from './db/repositories/accounts.repo'
import { normalizeAmountText, parseDayLabel, parseBillShot } from '@shared/billshot'

/**
 * 账单截图导入的自检：不依赖真图与 OCR，用「与你截图同版式的文本框」走完整链路。
 *
 * 覆盖：模板判定、日期解析、减号归一化、收支方向（转账归入收支）、分类映射、
 * 日小计核对、入库、二次导入去重、以及故意做坏的情况要被抓出来。
 */
interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

export function runBillShotProbe(): number {
  const results: CheckResult[] = []
  const check = (name: string, ok: boolean, detail: unknown): void => {
    results.push({ name, ok, detail: String(detail) })
  }

  // ---- 1. 单元级：金额与日期 ----
  const minus = normalizeAmountText('−9.00')
  check('数学减号 − 能识别为负数', minus.negative && minus.yuan === 9, JSON.stringify(minus))
  const plus = normalizeAmountText('+20.00')
  check('加号识别为正数', !plus.negative && plus.yuan === 20, JSON.stringify(plus))
  const grouped = normalizeAmountText('-1,234.56')
  check('千分位能去掉', grouped.yuan === 1234.56, JSON.stringify(grouped))
  const full = normalizeAmountText('−１２．３４')
  check('全角数字与全角减号能识别', full.negative && full.yuan === 12.34, JSON.stringify(full))
  check('日期「9月28日」解析正确', parseDayLabel('9月28日 昨天', 2026) === '2026-09-28', String(parseDayLabel('9月28日 昨天', 2026)))
  check('日期「2025年12月31日」解析正确', parseDayLabel('2025年12月31日', 2026) === '2025-12-31', '')

  // ---- 2. 版面级：用与真实截图同版式的文本框 ----
  const boxes: TextBox[] = [
    { text: '记账本', x: 0.42, y: 0.08, w: 0.16, h: 0.02 },
    { text: '全部类型', x: 0.06, y: 0.12, w: 0.18, h: 0.02 },
    { text: '2026年9月', x: 0.06, y: 0.155, w: 0.2, h: 0.022 },
    { text: '总支出¥2856.54', x: 0.28, y: 0.155, w: 0.32, h: 0.022 },
    { text: '总入账¥10711.54', x: 0.62, y: 0.155, w: 0.33, h: 0.022 },
    // 底部 tab 与悬浮按钮：属于界面装饰，不能被当成分类
    { text: '明细', x: 0.15, y: 0.96, w: 0.08, h: 0.02 },
    { text: '统计', x: 0.46, y: 0.96, w: 0.08, h: 0.02 },
    { text: '设置', x: 0.78, y: 0.96, w: 0.08, h: 0.02 },
    { text: '记一笔', x: 0.74, y: 0.9, w: 0.16, h: 0.022 },
    // 9月28日
    { text: '9月28日 昨天', x: 0.06, y: 0.25, w: 0.28, h: 0.022 },
    { text: '出 117.50', x: 0.6, y: 0.25, w: 0.16, h: 0.022 },
    { text: '入 0.00', x: 0.78, y: 0.25, w: 0.15, h: 0.022 },
    { text: '娱乐', x: 0.16, y: 0.33, w: 0.1, h: 0.02 },
    { text: '20:52 | Valve', x: 0.16, y: 0.36, w: 0.3, h: 0.018 },
    { text: '−9.00', x: 0.82, y: 0.335, w: 0.12, h: 0.022 },
    { text: '转账', x: 0.16, y: 0.42, w: 0.1, h: 0.02 },
    { text: '20:17 | 转账-转给cdj', x: 0.16, y: 0.45, w: 0.4, h: 0.018 },
    { text: '−5.00', x: 0.82, y: 0.425, w: 0.12, h: 0.022 },
    { text: '其他', x: 0.16, y: 0.51, w: 0.1, h: 0.02 },
    { text: '19:55 | 鲁记丸子汤', x: 0.16, y: 0.54, w: 0.4, h: 0.018 },
    { text: '−80.00', x: 0.82, y: 0.515, w: 0.12, h: 0.022 },
    { text: '其他', x: 0.16, y: 0.6, w: 0.1, h: 0.02 },
    { text: '12:02 | 沙县小吃', x: 0.16, y: 0.63, w: 0.4, h: 0.018 },
    { text: '−18.00', x: 0.82, y: 0.605, w: 0.12, h: 0.022 },
    { text: '购物', x: 0.16, y: 0.69, w: 0.1, h: 0.02 },
    { text: '11:57 | 西安唐久便利连锁有限公司', x: 0.16, y: 0.72, w: 0.6, h: 0.018 },
    { text: '−5.50', x: 0.82, y: 0.695, w: 0.12, h: 0.022 },
    // 9月27日：第一笔被悬浮按钮遮住
    { text: '9月27日 星期日', x: 0.06, y: 0.78, w: 0.3, h: 0.022 },
    { text: '出 82.77', x: 0.6, y: 0.78, w: 0.16, h: 0.022 },
    { text: '入 0.00', x: 0.78, y: 0.78, w: 0.15, h: 0.022 },
    { text: '其他', x: 0.16, y: 0.86, w: 0.1, h: 0.02 },
    { text: '19:33 | 赵一鸣', x: 0.16, y: 0.89, w: 0.3, h: 0.018 },
    { text: '−15.77 记一笔', x: 0.72, y: 0.865, w: 0.26, h: 0.022 }
  ]

  const page = classifyPage(boxes)
  check('识别为「记账本明细页」模板', page.template === 'ji-zhang-ben-detail', page.reasons.join(' / '))
  check('顶部月份识别为 2026-09', page.month === '2026-09', String(page.month))
  check(
    '顶部汇总识别正确',
    page.totalExpenseYuan === 2856.54 && page.totalIncomeYuan === 10711.54,
    `支出 ${page.totalExpenseYuan} / 入账 ${page.totalIncomeYuan}`
  )

  const layout = extractLayout(boxes, page)
  // 诊断：把抽到的行原样打出来，定位是「切行」还是「配对」出的问题
  const diag: string[] = []
  for (const day of layout.days) {
    diag.push(`${day.label} 出=${day.expenseYuan} 入=${day.incomeYuan}`)
    for (const line of day.lines) {
      diag.push(
        `  ${line.amountText} | 分类=${line.shotCategory || '-'} 时间=${line.time || '-'} 商户=${line.merchant || '-'} 可疑=${line.suspicious}`
      )
    }
  }
  check('抽出结果自检', layout.days[0]?.lines[0]?.merchant === 'Valve', diag.join(' ⏎ '))
  check('切出两个日期分组', layout.days.length === 2, layout.days.map((day) => day.label).join(' / '))
  check(
    '9月28日切出 5 笔',
    layout.days[0]?.lines.filter((line) => !line.isSubtotal).length === 5,
    String(layout.days[0]?.lines.length)
  )
  check(
    '日小计读到「出 117.50」',
    layout.days[0]?.expenseYuan === 117.5,
    String(layout.days[0]?.expenseYuan)
  )
  check(
    '商户与时间成对抽出',
    layout.days[0]?.lines[0]?.merchant === 'Valve' && layout.days[0]?.lines[0]?.time === '20:52',
    `${layout.days[0]?.lines[0]?.time} / ${layout.days[0]?.lines[0]?.merchant}`
  )

  // ---- 3. 解析：方向、分类、核对 ----
  const accountId = accountsRepo.list()[0]?.id ?? null
  const mapping = billShot.resolveCategoryMapping()
  const parsed = parseBillShot(layout, { fallbackYear: 2026, mapping })

  check('解析出 6 笔（5 + 1）', parsed.items.length === 6, String(parsed.items.length))
  check(
    '全部按金额正负归入支出（没有 transfer）',
    parsed.items.every((item) => item.type === 'expense'),
    parsed.items.map((item) => `${item.note}:${item.type}`).join(', ')
  )
  check(
    '「转账-转给cdj」按支出处理且不挂转账分类',
    parsed.items.some((item) => item.merchant === '转账-转给cdj' && item.type === 'expense' && item.categoryId === null),
    JSON.stringify(parsed.items.find((item) => item.merchant === '转账-转给cdj'))
  )
  check(
    '9月28日 逐笔之和 = 小计 117.50',
    parsed.reconciliation[0]?.computedExpense === 11750 && parsed.reconciliation[0]?.ok === true,
    JSON.stringify(parsed.reconciliation[0])
  )
  check(
    '9月27日 对不上小计时会被标出来',
    parsed.reconciliation[1]?.ok === false &&
      parsed.warnings.some((warning) => warning.includes('9月27日')),
    `${JSON.stringify(parsed.reconciliation[1])}｜告警 ${parsed.warnings.join(' | ')}`
  )
  check(
    '被悬浮按钮遮挡的那笔被标记',
    parsed.items.some((item) => item.issues.some((issue) => issue.includes('遮挡'))),
    parsed.items.flatMap((item) => item.issues).join(' | ') || '（没有标记）'
  )
  check(
    '分类映射挂到了真实分类 id',
    parsed.items.some((item) => item.shotCategory === '娱乐' && Boolean(item.categoryId)),
    `娱乐 → ${parsed.items.find((item) => item.shotCategory === '娱乐')?.categoryId ?? '未映射'}`
  )

  // ---- 4. 服务级：预览 + 入库 + 去重 ----
  const preview = billShot.preview([], { layouts: [layout] })
  check('预览返回候选并带映射表', preview.candidates.length === 6 && Object.keys(preview.categoryMapping).length > 0, `${preview.candidates.length} 笔`)
  check('预览阶段不写库', recordsRepo.list({ limit: 10000 }).total === 0, String(recordsRepo.list({ limit: 10000 }).total))

  const importable = preview.candidates.filter((item) => !item.issues.some((issue) => issue.includes('遮挡')))
  const commit = billShot.commit({
    accountId,
    tag: '账单导入',
    items: importable.map((item) => ({
      date: item.date,
      amount: item.amount,
      type: item.type,
      categoryId: item.categoryId,
      note: item.note,
      time: item.time,
      fingerprint: item.fingerprint,
      shotCategory: item.shotCategory
    }))
  })
  check('入库 5 笔（跳过被遮挡的 1 笔）', commit.created === 5, `created=${commit.created} skipped=${commit.skipped}`)

  const stored = recordsRepo.list({ limit: 100 })
  // 9月28日 117.50 全部导入
  check('库里的合计与勾选一致', stored.expenseTotal === 11750, `支出合计 ${stored.expenseTotal}，应为 11750`)
  check(
    '打上了统一标签',
    stored.items.every((item) => item.tags.includes('账单导入')),
    stored.items.map((item) => item.tags.join(',')).join(' | ')
  )
  check(
    '备注保留了商户名',
    stored.items.some((item) => item.note === 'Valve') || stored.items.some((item) => item.note === '鲁记丸子汤'),
    stored.items.map((item) => item.note).join(', ')
  )

  // 再导入一次：同样的候选应当全部被判重复
  const again = billShot.preview([], { layouts: [layout] })
  const duplicates = again.candidates.filter((item) => item.duplicate).length
  check('二次导入把已有记录判为重复', duplicates >= 5, `判重 ${duplicates} / ${again.candidates.length}`)
  const second = billShot.commit({
    accountId,
    tag: '账单导入',
    items: importable.map((item) => ({
      date: item.date,
      amount: item.amount,
      type: item.type,
      categoryId: item.categoryId,
      note: item.note,
      time: item.time,
      fingerprint: item.fingerprint,
      shotCategory: item.shotCategory
    }))
  })
  check(
    '二次导入同样这 5 笔不会重复写库',
    second.created === 0 && second.skipped === importable.length,
    `created=${second.created} skipped=${second.skipped} / ${importable.length}`
  )
  check('二次导入后库里仍是 5 笔', recordsRepo.list({ limit: 100 }).total === 5, String(recordsRepo.list({ limit: 100 }).total))

  // ---- 5. 未知模板要有降级提示 ----
  const unknown = classifyPage([{ text: '账单', x: 0.4, y: 0.1, w: 0.2, h: 0.02 }])
  check(
    '认不出的截图会明确告警而不是瞎猜',
    unknown.template === null && unknown.warnings.length > 0,
    unknown.warnings.join(' | ')
  )

  // 收尾：清掉这次写入的导入记录与映射，避免影响别的自检
  recordsRepo.hardDelete(stored.items.map((item) => item.id))
  const remaining = recordsRepo.list({ limit: 10 }).total
  check('自检数据已清理', remaining === 0, `剩余 ${remaining} 笔`)

  const passed = results.filter((item) => item.ok).length
  console.log(`\n===== 账单截图验证：${passed}/${results.length} 通过 =====`)
  for (const item of results) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
  }
  return passed === results.length ? 0 : 1
}
