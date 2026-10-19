import type { RawBillDay, RawBillShot } from '@shared/billshot'

/**
 * 账单截图 → 版面事实（RawBillShot）。
 *
 * 输入是从截图里拿到的文本框（真实运行时由 OCR 侧车提供，验证时直接喂进来）。
 * 这里不引入任何模型与网络：能不能跑取决于文本框质量，而不是有没有联网。
 */

export interface TextBox {
  text: string
  /** 归一化坐标（0-1），相对所在图片 */
  x: number
  y: number
  w: number
  h: number
  /** OCR 置信度 0-1；手工构造的用例可以不给 */
  score?: number
}

export interface PageClassification {
  /** 匹配到的模板名；null 表示没认出来 */
  template: 'ji-zhang-ben-detail' | null
  /** 命中的特征，用于给用户解释「为什么认成这样」 */
  reasons: string[]
  /** 顶部横幅底部的归一化 y，用来裁掉状态栏/标题栏 */
  headerBottom: number
  /** 整页月份 YYYY-MM */
  month: string | null
  totalExpenseYuan: number | null
  totalIncomeYuan: number | null
  warnings: string[]
}

const MONTH_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月/
const TOTAL_EXPENSE_RE = /总支出\s*[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/
const TOTAL_INCOME_RE = /总入账\s*[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/
const DAY_HEADER_RE = /^(\d{1,2})月(\d{1,2})日/
const SUBTOTAL_RE = /^[出入]\s*([\d,]+(?:\.\d{1,2})?)$/
/** 右侧独立的金额块：±数字，固定两位小数 */
const AMOUNT_ONLY_RE = /^[-−–—+]?\s*[¥￥]?\s*[\d,]+\.\d{2}$/
/** 行尾金额：处理「−15.77 记一笔」这种与悬浮按钮叠在一起的写法 */
const TRAILING_AMOUNT_RE = /([-−–—+]?\s*[¥￥]?\s*[\d,]+\.\d{2})\s*$/
/** 只认 20:52 / 9:05 这种时间；中文两侧没有单词边界，不能用 \b */
const TIME_RE = /(?:^|[^\d:])([0-2]?\d:[0-5]\d)(?![\d:])/
/** 左侧那一列（分类列）的右边界 */
const CATEGORY_COLUMN_MAX_X = 0.35
/** 界面装饰词：擦掉而不是丢掉整块，「−15.77 记一笔」里的金额是有用的 */
const CHROME_WORDS = /记一笔|全部类型|记账本|明细|统计|设置/g
/** 分隔符：真实 OCR 会把「时间 | 商户」的竖线认成 ㄧ / ｜ / · 等，统一当成竖线 */
const SEPARATOR_RE = /^[\s|｜·ㄧⅠ丨]+/
/** 置信度低于这个值的块直接丢：账单里出现的多半是图标碎片或标点噪声 */
const MIN_BOX_SCORE = 0.5

function stripChrome(text: string): string {
  return text.replace(CHROME_WORDS, '').replace(/\s+/g, ' ').trim()
}

/**
 * 清洗 OCR 结果：
 *  - 丢掉置信度过低的块（实测噪声长这样：s=0.37 的一块「，」落在分类列，会被误当分类名）
 *  - 丢掉纯标点块
 */
export function cleanBoxes(boxes: TextBox[]): { boxes: TextBox[]; dropped: number } {
  const kept = boxes.filter((box) => {
    if (box.score !== undefined && box.score < MIN_BOX_SCORE) return false
    if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(box.text)) return false
    return true
  })
  return { boxes: kept, dropped: boxes.length - kept.length }
}

/** 识别整页：模板判定 + 顶部汇总 */
export function classifyPage(boxes: TextBox[]): PageClassification {
  const reasons: string[] = []
  const warnings: string[] = []
  const all = boxes.map((box) => box.text).join(' ')

  const hasTitle = all.includes('记账本')
  if (hasTitle) reasons.push('标题含「记账本」')
  const hasTabs = all.includes('明细') && (all.includes('统计') || all.includes('设置'))
  if (hasTabs) reasons.push('底部有「明细 / 统计 / 设置」三个 tab')

  const monthMatch = all.match(MONTH_RE)
  const month = monthMatch ? `${monthMatch[1]}-${String(Number(monthMatch[2])).padStart(2, '0')}` : null
  if (month) reasons.push(`顶部月份 ${month}`)

  const expense = all.match(TOTAL_EXPENSE_RE)
  const income = all.match(TOTAL_INCOME_RE)
  /**
   * 顶部汇总只用来「显示」，不参与任何校验（截图通常只覆盖半个月）。
   * 实测 OCR 会把这一行的小数点吃掉（¥2856.54 → 285654），所以**没有小数点就宁可判为读不出**，
   * 显示成「—」也比显示一个错 100 倍的数字强。
   */
  const toYuan = (value: string | undefined): number | null => {
    if (!value || !value.includes('.')) return null
    const parsed = Number(value.replace(/,/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  if (!expense) warnings.push('没找到「总支出」汇总')
  if (!income) warnings.push('没找到「总入账」汇总')
  if (expense && !expense[1].includes('.')) warnings.push('顶部「总支出」的小数点没读出来，已忽略该数字')
  if (income && !income[1].includes('.')) warnings.push('顶部「总入账」的小数点没读出来，已忽略该数字')

  const banner = boxes
    .filter((box) => /总支出|总入账/.test(box.text))
    .reduce((max, box) => Math.max(max, box.y + box.h), 0)
  const headerBottom = banner > 0 ? Math.min(0.5, banner + 0.005) : 0.14

  const template = hasTitle && hasTabs && month ? 'ji-zhang-ben-detail' : null
  if (!template) warnings.push('没有匹配到已知的截图模板，仅按通用规则尝试解析')

  return {
    template,
    reasons,
    headerBottom,
    month,
    totalExpenseYuan: toYuan(expense?.[1]),
    totalIncomeYuan: toYuan(income?.[1]),
    warnings
  }
}

/** 一条正在拼装的记录 */
interface Entry {
  shotCategory: string
  time: string
  merchant: string
  amountYuan: number | null
  amountText: string
  suspicious: boolean
}

function newEntry(shotCategory = ''): Entry {
  return { shotCategory, time: '', merchant: '', amountYuan: null, amountText: '', suspicious: false }
}

/**
 * 把文本框翻译成日期分组与逐笔。
 *
 * 关键：**不能假设「一行 = 一条记录」**。
 * 真实截图里一张卡片内行距很密，日期头和当天多笔记录会被 y 聚合成同一行；
 * 所以这里按「块的先后顺序」扫描，用「分类块」作为一条记录的开始，
 * 金额块与「时间 | 商户」块都归给最近打开的那条记录。
 */
export function extractLayout(boxes: TextBox[], page: PageClassification): RawBillShot {
  const warnings = [...page.warnings]
  const cleaned = cleanBoxes(boxes)
  if (cleaned.dropped > 0) warnings.push(`忽略了 ${cleaned.dropped} 个低置信度/无意义文本块`)
  const ordered = [...cleaned.boxes]
    .filter((box) => box.y >= page.headerBottom && box.y <= 0.955)
    .sort((a, b) => a.y - b.y || a.x - b.x)

  const days: RawBillDay[] = []
  let current: RawBillDay | null = null
  let entry: Entry | null = null

  const closeEntry = (): void => {
    if (!current || !entry) return
    if (entry.amountYuan === null) {
      // 只有金额缺失才值得报警；分类块本身可能只是装饰
      if (entry.time || entry.merchant) {
        warnings.push(`「${entry.time || ''} ${entry.merchant || entry.shotCategory}」没读到金额，已跳过`)
      }
      entry = null
      return
    }
    current.lines.push({
      text: `${entry.shotCategory} ${entry.time} ${entry.merchant} ${entry.amountText}`.trim(),
      merchant: entry.merchant.trim(),
      time: entry.time,
      shotCategory: entry.shotCategory,
      amountYuan: entry.amountYuan,
      amountText: entry.amountText,
      isSubtotal: false,
      suspicious: entry.suspicious
    })
    entry = null
  }

  for (const box of ordered) {
    const raw = box.text.trim()
    if (!raw) continue

    // 1) 日期头：收掉上一条，开新的一天
    const dayMatch = raw.match(DAY_HEADER_RE)
    if (dayMatch) {
      closeEntry()
      current = {
        label: `${dayMatch[1]}月${dayMatch[2]}日`,
        date: null,
        expenseYuan: null,
        incomeYuan: null,
        lines: []
      }
      days.push(current)
      continue
    }
    if (!current) continue

    // 2) 日小计：「出 117.50」「入 0.00」
    const subtotal = raw.match(SUBTOTAL_RE)
    if (subtotal) {
      const value = Number(subtotal[1].replace(/,/g, ''))
      if (Number.isFinite(value)) {
        if (raw[0] === '出') current.expenseYuan = value
        else current.incomeYuan = value
      }
      continue
    }

    // 3) 纯装饰块（底部 tab、日期尾巴上的「昨天」）直接跳过；
    //    但像「−15.77 记一笔」这种夹了信息的块必须先擦掉装饰词再继续处理
    const text = stripChrome(raw)
    if (!text) continue
    // 原块里还有别的文字（例如「记一笔」被擦掉了）→ 金额很可能被悬浮按钮压着，需要人核一眼
    const hadChrome = text !== raw

    // 4) 单独成块的金额：归给当前记录，并**保留**这条记录（后面还会来「时间 | 商户」块）
    if (AMOUNT_ONLY_RE.test(text)) {
      if (!entry) entry = newEntry()
      if (entry.amountYuan === null) {
        entry.amountYuan = parseSignedAmount(text)
        entry.amountText = text
        if (hadChrome) entry.suspicious = true
      }
      continue
    }

    // 5) 「时间 | 商户」块：粘给最近一条还缺说明的记录。
    // 真实截图里这种块可能出现在金额之后（大多数时候），也可能在金额之前（每张卡片的第一条）。
    const timeMatch = text.match(TIME_RE)
    if (timeMatch) {
      const rest = text.replace(timeMatch[0], '').replace(SEPARATOR_RE, '').trim()
      const stamp = timeMatch[1].padStart(5, '0')
      const needInfo = (item: { time: string; merchant: string }): boolean => !item.time && !item.merchant

      if (entry && needInfo(entry)) {
        entry.time = stamp
        if (rest) entry.merchant = rest
        continue
      }
      const last = current.lines[current.lines.length - 1]
      if (last && needInfo(last) && !entry) {
        // 说明后到：补进刚收尾的那条记录
        last.time = stamp
        if (rest) last.merchant = rest
        continue
      }
      // 说明已经配过 → 这是下一条记录
      closeEntry()
      entry = newEntry()
      entry.time = stamp
      if (rest) entry.merchant = rest
      continue
    }

    // 5b) 行尾带金额的文本：典型是「−15.77 记一笔」（悬浮按钮压住了金额），也可能是别的排版。
    // 只要这块里没有时间、且末尾是金额，就当一条记录，并标记「疑似被遮挡」让人核对。
    const trailing = text.match(TRAILING_AMOUNT_RE)
    if (trailing) {
      if (!entry) entry = newEntry()
      if (entry.amountYuan === null) {
        entry.amountYuan = parseSignedAmount(trailing[1])
        entry.amountText = trailing[1].trim()
        const rest = text.slice(0, trailing.index).replace(/记一笔/g, '').trim()
        if (rest && !entry.merchant && rest !== entry.shotCategory) entry.merchant = rest
        // 金额与别的文字挤在一起 → 可能不完整，必须让用户核一眼
        entry.suspicious = true
      }
      continue
    }
    // 6) 分类列：开一条新记录。已经在拼装的那条若还没拿到金额/说明，就认为这是它的分类
    if (box.x + box.w / 2 < CATEGORY_COLUMN_MAX_X) {
      if (entry && (entry.amountYuan === null || (!entry.merchant && !entry.time))) {
        entry.shotCategory = entry.shotCategory || text
      } else {
        closeEntry()
        entry = newEntry(text)
      }
      continue
    }

    // 7) 中间/右侧的其他文字：当作商户说明
    if (!entry) entry = newEntry()
    if (!entry.merchant) entry.merchant = text
  }
  closeEntry()

  return {
    month: page.month,
    totalExpenseYuan: page.totalExpenseYuan,
    totalIncomeYuan: page.totalIncomeYuan,
    days,
    warnings
  }
}

/** 带符号金额：−9.00 → -9，+20.00 → 20 */
export function parseSignedAmount(text: string): number {
  const negative = /[-−–—]/.test(text)
  const value = Number(text.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(value)) return 0
  return negative ? -value : value
}
