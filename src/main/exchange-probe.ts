import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as accountsRepo from './db/repositories/accounts.repo'
import * as categoriesRepo from './db/repositories/categories.repo'
import * as recordsRepo from './db/repositories/records.repo'
import { commitCsv, exportCsv, exportXlsx, previewCsv } from './services/exchange.service'
import { listZipEntries, readZipEntry } from './services/xlsx.writer'

/**
 * 导出 / 导入（CSV）自检：跑一遍「写记录 → 导出 → 再解析 → 再入库」的往返。
 *
 * 为什么必须验往返：CSV 的坑几乎都在边角上——逗号、引号、换行、UTF-8 BOM、
 * 类型中文化、金额元/分换算、去重指纹。这些错了用户不会立刻发现，等发现时账已经乱了。
 */
export function runExchangeProbe(): number {
  const results: { name: string; ok: boolean; detail: string }[] = []
  const check = (name: string, ok: boolean, detail: unknown): void => {
    results.push({ name, ok, detail: String(detail) })
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-exchange-'))
  try {
    const accounts = accountsRepo.list()
    const tree = categoriesRepo.tree()
    const expenseParent = tree.find((node) => node.type === 'expense')
    const salaryParent = tree.find((node) => node.name === '工资')
    check('预设账户与分类就绪', accounts.length >= 2 && Boolean(expenseParent), `${accounts.length} 账户 / ${tree.length} 分类`)

    // 故意用带逗号、双引号、换行的备注，验证转义
    const trickyNote = '超市采购, "特价" 满减'
    const created = [
      recordsRepo.create({
        date: '2026-09-20',
        amount: 12345,
        type: 'expense',
        channel: 'offline',
        categoryId: expenseParent?.children[0]?.id ?? null,
        accountId: accounts[0].id,
        toAccountId: null,
        note: trickyNote,
        noteColor: null,
        tags: ['日常', '测试']
      }),
      recordsRepo.create({
        date: '2026-09-21',
        amount: 1000000,
        type: 'income',
        channel: 'other',
        categoryId: salaryParent?.id ?? null,
        accountId: accounts[0].id,
        toAccountId: null,
        note: '九月工资',
        noteColor: null,
        tags: ['收入']
      }),
      recordsRepo.create({
        date: '2026-09-22',
        amount: 50000,
        type: 'transfer',
        channel: 'transfer',
        categoryId: null,
        accountId: accounts[0].id,
        toAccountId: accounts[1].id,
        note: '还信用卡',
        noteColor: null,
        tags: []
      })
    ]
    check('写入 3 笔（支出/收入/转账各一）', created.length === 3, `${created.length} 笔`)

    // ---- 导出 ----
    const csv = exportCsv({})
    check('导出的 CSV 带 UTF-8 BOM', csv.startsWith('\uFEFF'), JSON.stringify(csv.slice(0, 1)))
    check('表头是中文且含关键字', csv.includes('日期,类型,金额,账户,转入账户,分类,场景,备注,标签'), csv.split('\r\n')[0])
    check('类型写成中文', csv.includes(',支出,') && csv.includes(',收入,') && csv.includes(',转账,'), '支出/收入/转账')
    check('金额按元输出（两位小数）', csv.includes('123.45') && csv.includes('10000.00'), '123.45 / 10000.00')
    check('带逗号与引号的备注被正确转义', csv.includes('"超市采购, ""特价"" 满减"'), '已加引号并双写内部引号')

    // ---- 导出 xlsx（必须在这三笔还在库里的时候做）----
    const xlsx = exportXlsx({})
    check('xlsx 以 ZIP 签名开头（PK）', xlsx.subarray(0, 2).toString('latin1') === 'PK', xlsx.subarray(0, 2).toString('hex'))
    const entries = listZipEntries(xlsx)
    const required = [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml'
    ]
    check('xlsx 里六个必需部件齐全', required.every((name) => entries.includes(name)), entries.join(' / '))
    check('中央目录能被自己解析回来', entries.length === required.length, `${entries.length} 个条目`)

    const sheet = readZipEntry(xlsx, 'xl/worksheets/sheet1.xml')
    check('能解压出 sheet1.xml（deflate + CRC 正确）', Boolean(sheet && sheet.length > 0), `${sheet?.length ?? 0} 字节`)
    const sheetText = sheet?.toString('utf-8') ?? ''
    check('表头是加粗样式', sheetText.includes('<c r="A1" s="1"'), 'A1 使用样式 1')
    check('工作表名是「记录」', (readZipEntry(xlsx, 'xl/workbook.xml')?.toString('utf-8') ?? '').includes('name="记录"'), '记录')
    check('备注里的引号被 XML 转义', sheetText.includes('&quot;特价&quot;'), '&quot;')
    check('表头文字正确', sheetText.includes('日期') && sheetText.includes('转入账户'), '日期 / 转入账户')
    // 金额必须是数值单元格（<v>123.45</v>）而不是文本，否则 Excel 里不能求和。
    // 记录是按日期倒序返回的，所以不能假定第 2 行是哪一笔——这里按「整列都是数值」来断言。
    const cCells = sheetText.match(/<c r="C\d+"[^>]*>.*?<\/c>/g) ?? []
    const numericAmounts = cCells
      .filter((cell) => !cell.includes('t="inlineStr"'))
      .map((cell) => (cell.match(/<v>([\d.]+)<\/v>/) ?? [])[1])
      .filter(Boolean)
    check(
      '金额列全是数值单元格（Excel 可直接求和）',
      cCells.length === 4 && numericAmounts.length === 3,
      `C 列 ${cCells.length} 个单元格，数值 ${numericAmounts.length} 个：${numericAmounts.join(' / ')}`
    )
    check(
      '三笔金额都对',
      ['500', '10000', '123.45'].every((value) => numericAmounts.includes(value)),
      numericAmounts.join(' / ')
    )
    check('日期写成文本单元格', sheetText.includes('<c r="A2" t="inlineStr"'), 'A2')
    check('行数与记录数一致', (sheetText.match(/<row /g) ?? []).length === 4, `${(sheetText.match(/<row /g) ?? []).length} 行（含表头）`)

    const xlsxFile = path.join(dir, 'roundtrip.xlsx')
    writeFileSync(xlsxFile, xlsx)
    check('xlsx 已落盘且非空', statSync(xlsxFile).size > 500, `${statSync(xlsxFile).size} 字节`)

    // 留一份样本给外部工具验证（用自己写的解析器验自己写的东西不算数）：
    //   tar -tf .tmp/exchange-sample.xlsx      ← Windows 自带的 bsdtar 能读 zip
    //   Expand-Archive -Path ...xlsx -DestinationPath ...   ← PowerShell 也能解
    try {
      const sampleDir = path.join(process.cwd(), '.tmp')
      mkdirSync(sampleDir, { recursive: true })
      const sample = path.join(sampleDir, 'exchange-sample.xlsx')
      writeFileSync(sample, xlsx)
      check('已留下外部验证用的样本', statSync(sample).size > 500, sample)
    } catch {
      check('已留下外部验证用的样本', false, '写样本失败（不影响导出功能）')
    }

    const file = path.join(dir, 'roundtrip.csv')
    writeFileSync(file, csv, 'utf-8')

    // ---- 解析：同一批数据应当全部判为重复 ----
    const dupPreview = previewCsv(file)
    check('解析出 3 行', dupPreview.total === 3, String(dupPreview.total))
    check('没有解析问题', dupPreview.problems === 0, dupPreview.rows.flatMap((row) => row.issues).join(' | ') || '无')
    check('3 行全被判为与已有记录重复', dupPreview.duplicates === 3, `判重 ${dupPreview.duplicates}`)
    check(
      '备注往返一致（含逗号与引号）',
      dupPreview.rows.some((row) => row.note === trickyNote),
      JSON.stringify(dupPreview.rows.map((row) => row.note))
    )
    check(
      '标签往返一致',
      dupPreview.rows.some((row) => row.tags.includes('日常') && row.tags.includes('测试')),
      dupPreview.rows.map((row) => row.tags.join('+')).join(' | ')
    )
    check(
      '金额往返一致（分）',
      dupPreview.rows.some((row) => row.amount === 12345) && dupPreview.rows.some((row) => row.amount === 1000000),
      dupPreview.rows.map((row) => row.amount).join(',')
    )
    check(
      '分类名与账户名能映射回 id',
      dupPreview.rows.every((row) => row.accountId !== null),
      dupPreview.rows.map((row) => `${row.accountName}→${row.accountId ? 'ok' : 'null'}`).join(' | ')
    )

    // 重复行不该再写进去
    const dupCommit = commitCsv({
      rows: dupPreview.rows,
      createMissingCategories: false,
      overrideAccountId: null,
      tag: ''
    })
    check('重复导入被拦下（不再写库）', dupCommit.created === 0 && dupCommit.skipped === 3, `created=${dupCommit.created} skipped=${dupCommit.skipped}`)

    // ---- 清空后重新导入：验证「能真的记进去」 ----
    recordsRepo.hardDelete(created.map((item) => item.id))
    check('清空后库里没有记录', recordsRepo.list({ limit: 10 }).total === 0, String(recordsRepo.list({ limit: 10 }).total))

    const freshPreview = previewCsv(file)
    check('清空后同一文件不再判重', freshPreview.duplicates === 0, `判重 ${freshPreview.duplicates}`)

    const fresh = commitCsv({
      rows: freshPreview.rows,
      createMissingCategories: false,
      overrideAccountId: null,
      tag: 'CSV导入'
    })
    check('重新导入 3 笔成功', fresh.created === 3, `created=${fresh.created} skipped=${fresh.skipped}`)

    const stored = recordsRepo.list({ limit: 10 })
    check('库中笔数与金额正确', stored.total === 3 && stored.expenseTotal === 12345 && stored.incomeTotal === 1000000, `${stored.total} 笔 / 支出 ${stored.expenseTotal} / 收入 ${stored.incomeTotal}`)
    check(
      '入库后带上了统一标签',
      stored.items.every((item) => item.tags.includes('CSV导入')),
      stored.items.map((item) => item.tags.join('+')).join(' | ')
    )

    // ---- 脏数据容错 ----
    const messy = path.join(dir, 'messy.csv')
    writeFileSync(
      messy,
      [
        '日期,类型,金额,账户,分类,备注',
        '2026/9/8,支出,"1,234.56",微信,不存在的分类,逗号千分位',
        '2026.9.9,,−88.00,不存在账户,餐饮,缺类型且负号是数学减号',
        ',支出,50,微信,餐饮,缺日期',
        '2026-09-10,支出,0,微信,餐饮,金额为 0'
      ].join('\r\n'),
      'utf-8'
    )
    const messyPreview = previewCsv(messy)
    check('把「不存在的分类/账户」「缺日期」「金额为 0」都标出来了', messyPreview.problems >= 3, `问题行 ${messyPreview.problems}：${messyPreview.rows.flatMap((row) => row.issues).join(' | ')}`)
    const messyCommit = commitCsv({
      rows: messyPreview.rows.filter((row) => row.issues.length === 0),
      createMissingCategories: false,
      overrideAccountId: null,
      tag: ''
    })
    check('脏数据只导入能用的行', messyCommit.created <= 2, `created=${messyCommit.created}`)

    // 收尾：清干净
    recordsRepo.hardDelete(recordsRepo.list({ limit: 100 }).items.map((item) => item.id))
    check('自检数据已清理', recordsRepo.list({ limit: 10 }).total === 0, String(recordsRepo.list({ limit: 10 }).total))
  } catch (error) {
    check('探针执行完成', false, error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const passed = results.filter((item) => item.ok).length
  console.log(`\n===== 导入导出验证：${passed}/${results.length} 通过 =====`)
  for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
  return passed === results.length ? 0 : 1
}
