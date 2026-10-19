import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  CSV_HEADERS,
  TYPE_LABEL,
  mapHeaders,
  parseAmountCell,
  parseCsv,
  parseDateCell,
  parseTypeCell,
  toCsv,
  type ExportRow
} from '@shared/csv'
import { buildXlsx, type CellValue } from './xlsx.writer'
import type {
  CsvImportCommitInput,
  CsvImportCommitResult,
  CsvImportPreview,
  CsvImportRow,
  ExchangeResult,
  RecordQuery,
  RecordType
} from '@shared/types'
import * as accountsRepo from '../db/repositories/accounts.repo'
import * as categoriesRepo from '../db/repositories/categories.repo'
import * as recordsRepo from '../db/repositories/records.repo'

/**
 * 导入 / 导出。
 *
 * 口径：
 *  - 导出是「给人看的」：金额是元、类型是中文、账户与分类写名字；
 *    CSV 给通用场景（任何软件都能读），xlsx 给 Excel 用户（金额是数值，能直接求和）；
 *  - 导入只认 CSV：xlsx 要解析共享字符串与日期序列号，风险大一个量级，
 *    而所有记账软件都能导出 CSV；
 *  - 导入是「给人核对的」：先解析成候选行，标出重复与问题，**用户确认后才写库**；
 *  - 分类/账户只按名字匹配，匹配不上不猜；分类可选用「自动新建」开关。
 */
/** 把记录整理成导出用的行（CSV 与 xlsx 共用这一份口径，避免两条路径算得不一样） */
export function exportRows(query: RecordQuery): ExportRow[] {
  const result = recordsRepo.list({ ...query, limit: 100000 })
  const accountNames = new Map(accountsRepo.list(true).map((account) => [account.id, account.name]))
  const categoryNames = new Map<string, string>()
  for (const parent of categoriesRepo.tree(true)) {
    categoryNames.set(parent.id, parent.name)
    for (const child of parent.children) categoryNames.set(child.id, `${parent.name}/${child.name}`)
  }

  return result.items.map((item) => ({
    date: item.date,
    type: item.type,
    amountCents: item.amount,
    accountName: item.accountId ? accountNames.get(item.accountId) ?? '' : '',
    toAccountName: item.toAccountId ? accountNames.get(item.toAccountId) ?? '' : '',
    categoryName: item.categoryId ? categoryNames.get(item.categoryId) ?? '' : '',
    channel: item.channel,
    note: item.note,
    tags: item.tags
  }))
}

export function exportCsv(query: RecordQuery): string {
  return toCsv(exportRows(query))
}

/** 导出真 xlsx：金额写成数值（Excel 里能直接求和），日期写成文本（避免序列号偏移一天） */
export function exportXlsx(query: RecordQuery): Buffer {
  const rows = exportRows(query)
  const body: CellValue[][] = rows.map((row) => [
    row.date,
    TYPE_LABEL[row.type],
    Number((row.amountCents / 100).toFixed(2)),
    row.accountName,
    row.toAccountName,
    row.categoryName,
    row.channel,
    row.note,
    row.tags.join(' ')
  ])
  return buildXlsx([...CSV_HEADERS], body)
}

/** 写 CSV 文件（Excel / WPS 双击即开） */
export function writeCsvFile(filePath: string, text: string): ExchangeResult {
  writeFileSync(filePath, text, 'utf-8')
  const rows = text.split('\r\n').filter((line) => line.trim() !== '').length - 1
  return { ok: true, filePath, rows: Math.max(0, rows) }
}

/** 写真 xlsx 文件 */
export function writeXlsxFile(filePath: string, buffer: Buffer, rows: number): ExchangeResult {
  writeFileSync(filePath, buffer)
  return { ok: true, filePath, rows }
}

/** 解析 CSV 文件成预览（只读，不写库） */
export function previewCsv(filePath: string): CsvImportPreview {
  const text = readFileSync(filePath, 'utf-8')
  const table = parseCsv(text)
  const warnings: string[] = []

  if (table.length === 0) {
    return { fileName: path.basename(filePath), rows: [], warnings: ['文件是空的'], total: 0, ready: 0, duplicates: 0, problems: 0 }
  }

  const header = table[0]
  const index = mapHeaders(header)
  if (index['日期'] < 0) warnings.push('没找到「日期」列，无法导入')
  if (index['金额'] < 0) warnings.push('没找到「金额」列，无法导入')
  if (index['类型'] < 0) warnings.push('没有「类型」列：将按金额正负推断收支')
  if (index['账户'] < 0) warnings.push('没有「账户」列：将记到默认账户')
  if (index['分类'] < 0) warnings.push('没有「分类」列：全部记为未分类')

  const accounts = accountsRepo.list(true)
  const accountByName = new Map(accounts.map((account) => [account.name.trim(), account.id]))
  const categories = categoriesRepo.tree(true)
  const categoryByName = new Map<string, { id: string; type: RecordType }>()
  for (const parent of categories) {
    categoryByName.set(parent.name.trim(), { id: parent.id, type: parent.type })
    for (const child of parent.children) {
      categoryByName.set(child.name.trim(), { id: child.id, type: parent.type })
      categoryByName.set(`${parent.name}/${child.name}`.trim(), { id: child.id, type: parent.type })
    }
  }

  const existing = new Set<string>()
  for (const item of recordsRepo.list({ limit: 100000 }).items) {
    existing.add([item.date, item.type, item.amount, item.note.trim().toLowerCase()].join('\u0001'))
  }

  const rows: CsvImportRow[] = []
  const fallbackYear = new Date().getFullYear()
  const seenInFile = new Set<string>()

  for (let i = 1; i < table.length; i++) {
    const line = table[i]
    const cell = (column: string): string => {
      const at = index[column]
      return at >= 0 && at < line.length ? line[at].trim() : ''
    }

    const issues: string[] = []
    const date = parseDateCell(cell('日期'), fallbackYear)
    if (!date) issues.push('日期读不出来')

    const money = parseAmountCell(cell('金额'))
    if (!money || money.cents === 0) issues.push('金额读不出来或为 0')

    const amount = money?.cents ?? 0
    const parsedType = parseTypeCell(cell('类型'), money?.negative ? -1 : 1)
    if (parsedType.inferred && cell('类型')) issues.push(`类型「${cell('类型')}」不认识，已按金额正负推断`)

    const type: RecordType = parsedType.type
    const accountName = cell('账户')
    const accountId = accountName ? accountByName.get(accountName) ?? null : null
    if (accountName && !accountId) issues.push(`账户「${accountName}」不存在`)

    const toAccountName = cell('转入账户')
    const toAccountId = toAccountName ? accountByName.get(toAccountName) ?? null : null
    if (type === 'transfer' && !toAccountId) issues.push('转账缺少有效的转入账户')

    const categoryName = cell('分类')
    const matched = categoryName ? categoryByName.get(categoryName) ?? null : null
    if (categoryName && !matched) issues.push(`分类「${categoryName}」不存在`)

    const note = cell('备注')
    const tags = cell('标签')
      .split(/[\s,，]+/)
      .map((tag) => tag.replace(/^#/, '').trim())
      .filter(Boolean)

    const fingerprint = [date ?? '', type, amount, note.trim().toLowerCase()].join('\u0001')
    const duplicate = existing.has(fingerprint) || seenInFile.has(fingerprint)
    seenInFile.add(fingerprint)
    if (duplicate) issues.push('与已有记录重复')

    rows.push({
      line: i + 1,
      date: date ?? '',
      amount,
      type,
      accountName,
      accountId,
      toAccountName,
      toAccountId,
      categoryName,
      categoryId: matched?.id ?? null,
      channel: cell('场景') || 'other',
      note,
      tags,
      duplicate,
      issues
    })
  }

  return {
    fileName: path.basename(filePath),
    rows,
    warnings,
    total: rows.length,
    ready: rows.filter((row) => row.issues.length === 0).length,
    duplicates: rows.filter((row) => row.duplicate).length,
    problems: rows.filter((row) => row.issues.some((issue) => !issue.includes('重复'))).length
  }
}

/** 确认后写库 */
export function commitCsv(input: CsvImportCommitInput): CsvImportCommitResult {
  const defaultAccountId =
    input.overrideAccountId || accountsRepo.list()[0]?.id || null
  const tag = (input.tag || '').trim()
  const existing = new Set<string>()
  for (const item of recordsRepo.list({ limit: 100000 }).items) {
    existing.add([item.date, item.type, item.amount, item.note.trim().toLowerCase()].join('\u0001'))
  }

  const categoryCache = new Map<string, string>()
  let created = 0
  let skipped = 0
  let createdCategories = 0
  let fallbackAccount = 0

  for (const row of input.rows) {
    if (!row.date || row.amount <= 0) {
      skipped += 1
      continue
    }
    const fingerprint = [row.date, row.type, row.amount, row.note.trim().toLowerCase()].join('\u0001')
    if (existing.has(fingerprint)) {
      skipped += 1
      continue
    }

    // 分类：按名字找；找不到时（可选）自动新建
    let categoryId = row.categoryId
    if (!categoryId && row.categoryName && input.createMissingCategories && row.type !== 'transfer') {
      const cacheKey = `${row.type}:${row.categoryName}`
      categoryId = categoryCache.get(cacheKey) ?? null
      if (!categoryId) {
        try {
          const created2 = categoriesRepo.create({
            name: row.categoryName,
            icon: 'inbox',
            color: '#8A9BA8',
            type: row.type === 'income' ? 'income' : 'expense',
            parentId: null
          })
          categoryId = created2.id
          categoryCache.set(cacheKey, categoryId)
          createdCategories += 1
        } catch {
          categoryId = null
        }
      }
    }

    let accountId = input.overrideAccountId || row.accountId || defaultAccountId
    if (!input.overrideAccountId && !row.accountId) fallbackAccount += 1
    if (row.type === 'transfer' && !accountId) accountId = defaultAccountId

    recordsRepo.create({
      date: row.date,
      amount: row.amount,
      type: row.type,
      channel: row.channel || 'other',
      categoryId: row.type === 'transfer' ? null : categoryId,
      accountId,
      toAccountId: row.type === 'transfer' ? row.toAccountId : null,
      note: row.note,
      noteColor: null,
      tags: [...row.tags, ...(tag ? [tag] : [])]
    })
    existing.add(fingerprint)
    created += 1
  }

  return { created, skipped, createdCategories, fallbackAccount }
}
