/**
 * CSV 导出 / 导入：纯逻辑，不碰文件系统、不碰数据库。
 *
 * 为什么是 CSV 而不是真 .xlsx：Excel 能直接打开带 BOM 的 UTF-8 CSV，
 * 而生成 xlsx 要多引一个打包器级别的依赖（几百 KB 起）并处理 OOXML 细节；
 * 对一个离线小工具来说不划算。导出的 CSV 用 Excel / WPS / Numbers 双击即开，
 * 也能被任何记账软件导入，互通性最好。
 */
import type { RecordType } from './types'
import { normalizeAmountText, yuanToCents } from './billshot'

/** 导出表头（也是导入时认的表头） */
export const CSV_HEADERS = ['日期', '类型', '金额', '账户', '转入账户', '分类', '场景', '备注', '标签'] as const

export const TYPE_LABEL: Record<RecordType, string> = { income: '收入', expense: '支出', transfer: '转账' }
const LABEL_TYPE: Record<string, RecordType> = {
  收入: 'income',
  支出: 'expense',
  转账: 'transfer',
  income: 'income',
  expense: 'expense',
  transfer: 'transfer'
}

/** 导出用的一行（金额已是元字符串，账户/分类已解析成名字） */
export interface ExportRow {
  date: string
  type: RecordType
  amountCents: number
  accountName: string
  toAccountName: string
  categoryName: string
  channel: string
  note: string
  tags: string[]
}

/** 单元格转义：含逗号/引号/换行就用双引号包起来，内部引号双写（RFC 4180） */
function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function money(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** 生成 CSV 文本。带 UTF-8 BOM，Excel 双击不乱码 */
export function toCsv(rows: ExportRow[]): string {
  const lines = [CSV_HEADERS.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.date,
        TYPE_LABEL[row.type],
        money(row.amountCents),
        row.accountName,
        row.toAccountName,
        row.categoryName,
        row.channel,
        row.note,
        row.tags.join(' ')
      ]
        .map((cell) => escapeCell(String(cell ?? '')))
        .join(',')
    )
  }
  // CRLF 是 Excel 更认的换行；BOM 让 Excel 判定为 UTF-8
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

/** 解析 CSV 文本 → 二维数组（支持引号包裹、内部逗号/换行/双引号） */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]
    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\r') continue
    if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += char
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((line) => line.some((value) => value.trim() !== ''))
}

/** 表头别名：不同软件导出的列名不一样，尽量认出来 */
const HEADER_ALIASES: Record<string, string[]> = {
  日期: ['日期', 'date', '时间', '交易时间', '记账日期'],
  类型: ['类型', '收支', 'type', '收支类型'],
  金额: ['金额', 'amount', '金额(元)', '金额（元）', '交易金额'],
  账户: ['账户', 'account', '账户名', '支付账户'],
  转入账户: ['转入账户', 'to', '目标账户', '转入'],
  分类: ['分类', 'category', '类别', '分类名'],
  场景: ['场景', 'channel', '渠道', '支付方式'],
  备注: ['备注', 'note', '说明', '摘要', '商户'],
  标签: ['标签', 'tags', 'tag']
}

/** 找出每个标准列在表头里的下标；找不到返回 -1 */
export function mapHeaders(header: string[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [standard, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = header.findIndex((cell) => aliases.includes(cell.trim().toLowerCase()) || aliases.includes(cell.trim()))
    result[standard] = index
  }
  return result
}

/** 日期容错：2026-09-28 / 2026/9/8 / 2026.9.8 / 20260928 都认 */
export function parseDateCell(raw: string, fallbackYear: number): string | null {
  const text = raw.trim()
  if (!text) return null
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return join(Number(compact[1]), Number(compact[2]), Number(compact[3]))
  const parts = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (parts) return join(Number(parts[1]), Number(parts[2]), Number(parts[3]))
  const short = text.match(/^(\d{1,2})[-/.月](\d{1,2})/)
  if (short) return join(fallbackYear, Number(short[1]), Number(short[2]))
  return null
}

function join(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/** 类型容错：中文/英文；缺失时按金额符号兜底推断 */
export function parseTypeCell(raw: string, amountCents: number): { type: RecordType; inferred: boolean } {
  const text = raw.trim()
  const known = LABEL_TYPE[text] ?? LABEL_TYPE[text.toLowerCase()]
  if (known) return { type: known, inferred: false }
  return { type: amountCents < 0 ? 'expense' : 'income', inferred: true }
}

/** 金额容错：走账单截图那套归一化（全角、千分位、各种减号），再转成分 */
export function parseAmountCell(raw: string): { cents: number; negative: boolean } | null {
  const parsed = normalizeAmountText(raw)
  if (parsed.yuan === null) return null
  const cents = yuanToCents(parsed.yuan)
  return { cents: Math.abs(cents), negative: parsed.negative }
}
