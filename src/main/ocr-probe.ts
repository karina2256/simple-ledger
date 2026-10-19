import { classifyPage, extractLayout } from './services/billshot.extract'
import { ocrAvailable, ocrModelDir, recognize } from './services/billshot.ocr'
import { preview } from './services/billshot.service'

/**
 * OCR 全链路实测：真实账单截图 → 识别 → 版面 → 解析 → 逐日核对。
 *
 * 用法：scripts/verify-ocr.mjs <图片路径…>
 * 只读，不写库。
 */
export async function runOcrProbe(filePaths: string[]): Promise<number> {
  try {
    console.log(`[ocr] 引擎可用=${ocrAvailable()}`)
    console.log(`[ocr] 模型目录=${ocrModelDir()}`)
    if (!ocrAvailable()) {
      console.error('[ocr] 模型缺失')
      return 1
    }

    for (const filePath of filePaths) {
      const started = Date.now()
      const boxes = await recognize(filePath)
      const elapsed = Date.now() - started

      console.log(`\n[ocr] ==== ${filePath} ====`)
      console.log(`[ocr] 识别 ${boxes.length} 个文本块，用时 ${elapsed}ms`)
      for (const box of boxes) {
        console.log(
          `[ocr]  y=${box.y.toFixed(4)} x=${box.x.toFixed(4)} w=${box.w.toFixed(4)} s=${box.score.toFixed(2)} 「${box.text}」`
        )
      }

      const page = classifyPage(boxes)
      console.log(`[ocr] 模板=${page.template ?? '未识别'} 月份=${page.month ?? '-'} 汇总=出${page.totalExpenseYuan ?? '-'}/入${page.totalIncomeYuan ?? '-'}`)
      console.log(`[ocr] 判定依据：${page.reasons.join(' / ') || '（无）'}`)

      const layout = extractLayout(boxes, page)
      console.log('[ocr] ---- 版面切分 ----')
      for (const day of layout.days) {
        console.log(`[ocr]  ${day.label} 出=${day.expenseYuan ?? '-'} 入=${day.incomeYuan ?? '-'}`)
        for (const line of day.lines) {
          console.log(
            `[ocr]    金额=${line.amountText} 分类=${line.shotCategory || '-'} 时间=${line.time || '-'} 商户=${line.merchant || '-'} 可疑=${line.suspicious}`
          )
        }
      }

      const result = preview([filePath], { pages: [{ boxes }] })
      console.log('[ocr] ---- 解析结果 ----')
      for (const item of result.candidates) {
        console.log(
          `[ocr]  ${item.date} ${item.time} ${item.type === 'income' ? '入账' : '支出'} ¥${(item.amount / 100).toFixed(2)} 分类=${item.shotCategory || '-'} 备注=${item.note} 分类id=${item.categoryId ? '已映射' : '未映射'} 问题=${item.issues.join(';') || '无'}`
        )
      }
      console.log('[ocr] ---- 逐日核对 ----')
      for (const row of result.reconciliation) {
        const stated = `出${((row.statedExpense ?? 0) / 100).toFixed(2)} 入${((row.statedIncome ?? 0) / 100).toFixed(2)}`
        const computed = `出${(row.computedExpense / 100).toFixed(2)} 入${(row.computedIncome / 100).toFixed(2)}`
        console.log(`[ocr]  ${row.label}  截图小计 ${stated}  逐笔之和 ${computed}  结论=${row.ok === null ? '无法校验' : row.ok ? '完整 ✅' : '不完整 ❌'}`)
      }
      console.log(`[ocr] 整体：候选 ${result.candidates.length} 笔，平=${result.balanced}，告警 ${result.warnings.length} 条`)
      for (const warning of result.warnings) console.log(`[ocr]  ⚠ ${warning}`)
    }
    return 0
  } catch (error) {
    console.error(`[ocr] 失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    return 1
  }
}

/** 无论成败都退出，避免探针把应用挂住 */
export function startOcrProbe(filePaths: string[], exit: (code: number) => void): void {
  const timeout = setTimeout(() => {
    console.error('[ocr] 超时（300s），强制退出')
    exit(1)
  }, 300_000)
  void runOcrProbe(filePaths).then((code) => {
    clearTimeout(timeout)
    exit(code)
  })
}
