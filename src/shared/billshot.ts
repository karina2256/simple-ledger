/**
 * 账单截图解析：纯逻辑，不碰文件系统、不碰数据库。
 *
 * 输入是从「记账本」类小程序截图里抽取出来的**版面事实**（见 billshot.extract.ts），
 * 这里只负责把它们翻译成记账记录：日期分组、正负号、分类映射、去重指纹与汇总校验。
 *
 * 放在 shared 里是为了能在主进程直接跑，也能被探针/测试单独调用。
 */
import type { RecordType } from './types'

/** 版面抽取出来的一行（尚未判定类型与分类） */
export interface RawBillLine {
  /** 原始文本，用于排错与展示 */
  text: string
  /** 交易说明：一般是「时间 | 商户」里竖线后面那段 */
  merchant: string
  /** 时间 HH:mm，抽不到就是空串 */
  time: string
  /** 截图上的分类名（娱乐 / 转账 / 其他 …），抽不到就是空串 */
  shotCategory: string
  /** 金额（元），正数=入账，负数=出账 */
  amountYuan: number
  /** 截图里的原始金额文本，例如「−9.00」 */
  amountText: string
  /** 该行是这一段日期分组下的小计行？小计行不产生记录 */
  isSubtotal: boolean
  /** 被悬浮按钮等遮住、金额可能不完整 */
  suspicious: boolean
}

/** 版面抽取出的日期分组 */
export interface RawBillDay {
  /** 原始日期文本，例如「9月28日」 */
  label: string
  /** 解析出的日期 YYYY-MM-DD；解析失败为 null */
  date: string | null
  /** 「出 117.50」 */
  expenseYuan: number | null
  /** 「入 0.00」 */
  incomeYuan: number | null
  lines: RawBillLine[]
}

/** 版面抽取的整页结果 */
export interface RawBillShot {
  /** 顶部汇总：总支出 / 总入账（元），没有就是 null */
  month: string | null
  totalExpenseYuan: number | null
  totalIncomeYuan: number | null
  days: RawBillDay[]
  /** 抽取过程中的告警，例如「有 2 行金额未识别」 */
  warnings: string[]
}

/** 分类映射：截图上的分类名 → 目标分类（空串表示留空不指定） */
export type CategoryMapping = Record<string, string>

/** 一条待入库的候选记录 */
export interface ParsedBillItem {
  /** 稳定指纹：日期+时间+金额+说明，用于跨次导入去重 */
  fingerprint: string
  date: string
  time: string
  /** 金额（分），恒为正数；方向看 type */
  amount: number
  type: RecordType
  /** 截图上的分类名 */
  shotCategory: string
  /** 映射后的目标分类 id；没映射上就是 null */
  categoryId: string | null
  merchant: string
  note: string
  /** 与库里已有记录重复 */
  duplicate: boolean
  /** 需要人工确认的原因（金额被遮挡、日期没解析出来等） */
  issues: string[]
}

/** 单日校验结果：日小计 vs 逐笔之和 */
export interface DayReconciliation {
  date: string
  label: string
  /** 逐笔之和（分） */
  computedExpense: number
  computedIncome: number
  /** 截图上的日小计（分），没有就是 null */
  statedExpense: number | null
  statedIncome: number | null
  /** 是否对得上；没有小计时为 null（无法校验） */
  ok: boolean | null
}

export interface ParseResult {
  month: string | null
  totalExpenseYuan: number | null
  totalIncomeYuan: number | null
  items: ParsedBillItem[]
  reconciliation: DayReconciliation[]
  /** 整体是否所有可比对的日小计都对得上 */
  balanced: boolean
  warnings: string[]
}

/** 归一化金额文本：全角数字、各种减号（− U+2212 / – / —）、人民币符号、千分位都要处理 */
export function normalizeAmountText(raw: string): { yuan: number | null; negative: boolean } {
  const trimmed = raw.trim()
  if (!trimmed) return { yuan: null, negative: false }
  const half = trimmed
    // 全角数字 ０-９ → 半角
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    // 全角句点/逗号 → 半角（OCR 偶尔会把小数点认成全角）
    .replace(/[．。｡]/g, '.')
    .replace(/[，､]/g, ',')
  const negative = /[-−–—]/.test(half)
  const digits = half.replace(/[^0-9.]/g, '')
  if (!digits || digits === '.') return { yuan: null, negative }
  const value = Number(digits)
  if (!Number.isFinite(value)) return { yuan: null, negative }
  return { yuan: value, negative }
}

/** 元 → 分（四舍五入到分） */
export function yuanToCents(yuan: number): number {
  return Math.round(yuan * 100)
}

/**
 * 推送去重用的指纹：日期 + 类型 + 金额 + 说明。
 *
 * **时间不参与**：同一笔账手工记时没有时间，截图里有时间，用时间做指纹会让
 * 「手工记过的账」在下次导入时判不出重复。粒度到「同一天同金额同说明同方向」足够。
 */
export function fingerprintOf(input: {
  date: string
  amountCents: number
  merchant: string
  type: RecordType
}): string {
  return [input.date, '', input.type, input.amountCents, input.merchant.trim().toLowerCase()].join('\u0001')
}

/** 把「9月28日」「09-28」「2026-09-28」这类文本解析成 YYYY-MM-DD */
export function parseDayLabel(label: string, fallbackYear: number): string | null {
  const text = label.replace(/\s+/g, '')
  const full = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (full) return toDate(Number(full[1]), Number(full[2]), Number(full[3]))
  const short = text.match(/(\d{1,2})月(\d{1,2})日/)
  if (short) return toDate(fallbackYear, Number(short[1]), Number(short[2]))
  const dashed = text.match(/(?:(\d{4})-)?(\d{1,2})-(\d{1,2})/)
  if (dashed) return toDate(dashed[1] ? Number(dashed[1]) : fallbackYear, Number(dashed[2]), Number(dashed[3]))
  return null
}

function toDate(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * 主解析：把版面事实翻译成候选记录 + 校验结果。
 *
 * 口径（按用户确认的规则）：
 *  - 金额为负 → expense（消费）；金额为正 → income（入账）；**不使用 transfer**
 *  - 「转账」这类分类名只作为来源标签，不改变类型判定
 *  - 日小计行不产生记录
 */
export function parseBillShot(
  shot: RawBillShot,
  options: {
    /** 日期里没有年份时用它 */
    fallbackYear: number
    /** 截图分类名 → 目标分类 id */
    mapping?: CategoryMapping
    /** 库里已有的指纹，用来标重复 */
    existingFingerprints?: Set<string>
    /** 过滤掉已存在的重复项（默认只标记不丢弃） */
    dropDuplicates?: boolean
  }
): ParseResult {
  const mapping = options.mapping ?? {}
  const existing = options.existingFingerprints ?? new Set<string>()
  const items: ParsedBillItem[] = []
  const reconciliation: DayReconciliation[] = []
  const warnings = [...shot.warnings]
  const seen = new Set<string>()

  for (const day of shot.days) {
    const date = day.date ?? parseDayLabel(day.label, options.fallbackYear)
    let computedExpense = 0
    let computedIncome = 0

    for (const line of day.lines) {
      if (line.isSubtotal) continue
      const cents = yuanToCents(Math.abs(line.amountYuan))
      if (cents <= 0) {
        warnings.push(`「${line.text}」金额识别为 0，已跳过`)
        continue
      }
      const issues: string[] = []
      if (!date) issues.push('日期没解析出来，需要手选')
      if (line.suspicious) issues.push('金额可能被悬浮按钮遮挡')

      const type: RecordType = line.amountYuan < 0 ? 'expense' : 'income'
      const merchant = line.merchant.trim()
      const fingerprint = fingerprintOf({
        date: date ?? day.label,
        amountCents: cents,
        merchant,
        type
      })

      if (seen.has(fingerprint)) issues.push('同一张截图里重复出现')
      seen.add(fingerprint)

      const duplicate = existing.has(fingerprint)
      if (duplicate) issues.push('与已有记录重复')
      if (duplicate && options.dropDuplicates) continue

      const categoryId = normalizeCategoryId(mapping[line.shotCategory])
      if (!categoryId) {
        // 「转账」这一档被用户要求取消：它落到支出/收入里，只是不打分类标签
        if (!line.shotCategory) issues.push('截图里没有分类，未指定')
      }

      const note = merchant || line.shotCategory || '账单导入'
      if (type === 'expense') computedExpense += cents
      else computedIncome += cents

      items.push({
        fingerprint,
        date: date ?? '',
        time: line.time,
        amount: cents,
        type,
        shotCategory: line.shotCategory,
        categoryId,
        merchant,
        note,
        duplicate,
        issues
      })
    }

    if (date) {
      const statedExpense = day.expenseYuan === null ? null : yuanToCents(day.expenseYuan)
      const statedIncome = day.incomeYuan === null ? null : yuanToCents(day.incomeYuan)
      const ok =
        statedExpense === null && statedIncome === null
          ? null
          : (statedExpense === null || statedExpense === computedExpense) &&
            (statedIncome === null || statedIncome === computedIncome)
      if (ok === false) {
        warnings.push(
          `${day.label} 逐笔之和（出 ${formatYuan(computedExpense)} / 入 ${formatYuan(computedIncome)}）` +
            `与截图小计（出 ${formatYuan(statedExpense ?? 0)} / 入 ${formatYuan(statedIncome ?? 0)}）对不上，请核对`
        )
      }
      reconciliation.push({ date, label: day.label, computedExpense, computedIncome, statedExpense, statedIncome, ok })
    }
  }

  return {
    month: shot.month,
    totalExpenseYuan: shot.totalExpenseYuan,
    totalIncomeYuan: shot.totalIncomeYuan,
    items,
    reconciliation,
    // 只要有任何一个可比对的日小计对不上，就不算平
    balanced: reconciliation.every((row) => row.ok !== false),
    warnings
  }
}

/** 空串 / undefined 视为「不指定分类」 */
function normalizeCategoryId(value: string | undefined): string | null {
  const text = (value ?? '').trim()
  return text ? text : null
}

export function formatYuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * 默认分类映射：截图分类名 → 目标分类名（按名字匹配，具体 id 在主进程里查）。
 * 「转账」按用户口径不单独成类，映射成空串（不指定分类，靠金额正负决定收支）。
 */
export const DEFAULT_SHOT_CATEGORY_MAP: Record<string, string> = {
  餐饮: '餐饮',
  交通: '交通',
  购物: '购物',
  居住: '居住',
  娱乐: '娱乐',
  医疗: '医疗',
  教育: '教育',
  人情: '人情',
  工资: '工资',
  理财: '理财',
  副业: '副业',
  红包: '红包',
  退款: '退款',
  其他: '其他支出',
  其他支出: '其他支出',
  其他收入: '其他收入',
  转账: ''
}

/** 判断一条候选是否「可以安全入库」：没有必须人工处理的问题 */
export function isReady(item: ParsedBillItem): boolean {
  return item.issues.length === 0 && Boolean(item.date)
}
