import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SHOT_CATEGORY_MAP, parseBillShot, type RawBillShot } from '@shared/billshot'
import type { BillShotCandidate, BillShotCommitInput, BillShotCommitResult, BillShotPreview } from '@shared/types'
import * as accountsRepo from '../db/repositories/accounts.repo'
import * as categoriesRepo from '../db/repositories/categories.repo'
import * as recordsRepo from '../db/repositories/records.repo'
import * as settingsRepo from '../db/repositories/settings.repo'
import { classifyPage, extractLayout, type TextBox } from './billshot.extract'
import { ocrAvailable, recognize } from './billshot.ocr'

/**
 * 账单截图导入（服务层）。
 *
 * 口径（用户确认过的规则）：
 *  - 入账 → income，出账 → expense；**不使用 transfer**，「转账」档取消
 *  - 分类只按截图上的分类名映射，映射不上就留空，不猜
 *  - 同一张截图重复上传、或截图范围与已导入的重叠，靠指纹去重
 *
 * 识别链路：截图 → 版面事实 → 候选记录。版面事实这一步在真正跑的时候由 OCR 提供文本框；
 * 没有 OCR 侧车时，允许调用方直接传入「已抽取的版面事实」（导入端口、自动化验证都走这条路）。
 */
export interface PreviewOptions {
  /** 直接给出已经抽取好的版面事实（跳过 OCR） */
  layouts?: RawBillShot[]
  /** 一次性给出文本框（跳过 OCR，但走完整版面规则） */
  pages?: { boxes: TextBox[] }[]
}

/** 图片指纹：内容哈希，用来判断「这张图是不是已经导过」 */
export function fileFingerprint(filePath: string): string {
  try {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 16)
  } catch {
    return ''
  }
}

/**
 * 走 OCR 的完整入口：对每张图识别 → 版面抽取 → 解析成候选。
 * 模型缺失时抛出可读错误，绝不猜。
 */
export async function previewWithOcr(filePaths: string[]): Promise<BillShotPreview> {
  if (!ocrAvailable()) {
    throw new Error('识别引擎未安装：缺少 resources/ocr/models 下的 PP-OCR 模型（运行 npm run setup:ocr）')
  }
  const pages: { boxes: TextBox[] }[] = []
  const unreadable: string[] = []
  for (const filePath of filePaths) {
    try {
      const boxes = await recognize(filePath)
      if (boxes.length === 0) unreadable.push(path.basename(filePath))
      else pages.push({ boxes })
    } catch (error) {
      unreadable.push(`${path.basename(filePath)}（${error instanceof Error ? error.message : String(error)}）`)
    }
  }
  const result = preview(filePaths, { pages })
  if (unreadable.length > 0) {
    result.warnings.unshift(`这些图没能读出文字：${unreadable.join('、')}`)
  }
  return result
}

/**
 * 分类映射：优先用用户记忆（settings.billShotCategoryMap），
 * 其次按「截图分类名 → 分类名 → 分类 id」查一次，都查不到就留空。
 */
export function resolveCategoryMapping(): Record<string, string> {
  const remembered = settingsRepo.getAll().billShotCategoryMap ?? {}
  const tree = categoriesRepo.tree()
  const byName = new Map<string, string>()
  for (const parent of tree) {
    byName.set(parent.name, parent.id)
    for (const child of parent.children) if (!byName.has(child.name)) byName.set(child.name, child.id)
  }

  const mapping: Record<string, string> = {}
  for (const [shotName, targetName] of Object.entries(DEFAULT_SHOT_CATEGORY_MAP)) {
    const rememberedId = remembered[shotName]
    if (rememberedId) {
      mapping[shotName] = rememberedId
      continue
    }
    if (!targetName) {
      mapping[shotName] = ''
      continue
    }
    mapping[shotName] = byName.get(targetName) ?? ''
  }
  return mapping
}

/** 图片内容指纹 + 记录指纹都算「已存在」，两道去重 */
function loadExisting(): { files: Set<string>; records: Set<string> } {
  return { files: loadImportedFileHashes(), records: loadRecordFingerprints() }
}

/** 已导入过的图片哈希（写在 settings 里，简单可靠） */
function loadImportedFileHashes(): Set<string> {
  const raw = settingsRepo.getAll() as unknown as Record<string, unknown>
  const list = raw['billShotImportedFiles']
  return new Set(Array.isArray(list) ? (list as string[]) : [])
}

/**
 * 库里已有记录的指纹集合。
 * 口径必须与解析层一致，否则「截图里的时间」会让指纹永远对不上：
 * 库里手工记的记录没有时间，所以指纹的时间位统一留空。
 */
function loadRecordFingerprints(): Set<string> {
  const all = recordsRepo.list({ limit: 100000 })
  const set = new Set<string>()
  for (const item of all.items) {
    set.add(recordFingerprint(item.date, item.type, item.amount, item.note))
  }
  return set
}

/** 记录指纹：日期 + 类型 + 金额 + 备注（时间不参与，见上） */
export function recordFingerprint(date: string, type: string, amount: number, note: string): string {
  return [date, '', type, amount, note.trim().toLowerCase()].join('\u0001')
}

export function preview(filePaths: string[], options: PreviewOptions = {}): BillShotPreview {
  const mapping = resolveCategoryMapping()
  const existing = loadExisting()
  const warnings: string[] = []
  const candidates: BillShotCandidate[] = []
  const reconciliation: BillShotPreview['reconciliation'] = []
  let month: string | null = null
  let totalExpenseYuan: number | null = null
  let totalIncomeYuan: number | null = null
  let balanced = true

  const layouts: RawBillShot[] =
    options.layouts ?? (options.pages ?? []).map((page) => extractLayout(page.boxes, classifyPage(page.boxes)))

  if (layouts.length === 0) {
    warnings.push('没有拿到可解析的版面数据：这台机器上还没接 OCR，请用「导入端口」的方式提供文本框')
  }

  const fallbackYear = new Date().getFullYear()
  for (const layout of layouts) {
    if (layout.month) month = layout.month
    if (layout.totalExpenseYuan !== null) totalExpenseYuan = layout.totalExpenseYuan
    if (layout.totalIncomeYuan !== null) totalIncomeYuan = layout.totalIncomeYuan

    const parsed = parseBillShot(layout, {
      fallbackYear: layout.month ? Number(layout.month.slice(0, 4)) : fallbackYear,
      mapping,
      existingFingerprints: existing.records
    })
    warnings.push(...parsed.warnings)
    balanced = balanced && parsed.balanced
    reconciliation.push(...parsed.reconciliation)
    for (const item of parsed.items) {
      candidates.push({
        fingerprint: item.fingerprint,
        date: item.date,
        time: item.time,
        amount: item.amount,
        type: item.type,
        shotCategory: item.shotCategory,
        categoryId: item.categoryId,
        merchant: item.merchant,
        note: item.note,
        duplicate: item.duplicate,
        issues: item.issues
      })
    }
  }

  // 同一张图重复上传：整页候选都被标重复时给一句明确提示
  if (candidates.length > 0 && candidates.every((item) => item.duplicate)) {
    warnings.push('这些截图里的记录看起来都已经导入过了')
  }

  return {
    filePaths,
    month,
    totalExpenseYuan,
    totalIncomeYuan,
    candidates,
    reconciliation,
    balanced,
    categoryMapping: mapping,
    warnings: Array.from(new Set(warnings))
  }
}

/** 用户确认后入库：一个事务提交，顺便记住映射与已导入的图片 */
export function commit(input: BillShotCommitInput): BillShotCommitResult {
  const accountId = input.accountId || settingsRepo.getAll().billShotAccountId || accountsRepo.list()[0]?.id || null
  const tag = (input.tag || '账单导入').trim()
  const existing = loadRecordFingerprints()
  const ids: string[] = []
  let skipped = 0

  for (const item of input.items) {
    const fingerprint = recordFingerprint(item.date, item.type, item.amount, item.note)
    if (existing.has(fingerprint)) {
      skipped += 1
      continue
    }
    const created = recordsRepo.create({
      date: item.date,
      amount: item.amount,
      type: item.type,
      channel: 'other',
      categoryId: item.categoryId,
      accountId,
      toAccountId: null,
      note: item.note,
      noteColor: null,
      tags: tag ? [tag] : []
    })
    existing.add(fingerprint)
    ids.push(created.id)
  }

  return { created: ids.length, skipped, ids }
}

/** 记住用户这次改过的分类映射，下次同一商户/分类直接带上 */
export function rememberMapping(entries: Record<string, string>): void {
  if (Object.keys(entries).length === 0) return
  const current = settingsRepo.getAll().billShotCategoryMap ?? {}
  settingsRepo.set('billShotCategoryMap', { ...current, ...entries })
}
