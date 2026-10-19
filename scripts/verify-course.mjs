/**
 * 讲义 PDF 自检：不靠肉眼，直接读生成物判断「这份讲义是不是真的能用」。
 *
 * 用法：npm run verify:course   （会在检查前自动重新生成一遍，确保验的是最新内容）
 *
 * 检查四件事：
 *   1. 每份讲义都生成了 PDF，且体积合理（太小的基本是空文档）
 *   2. PDF 结构完整：有页、有压缩流、内嵌了字体（没内嵌字体的中文 PDF 换台机器就变方框）
 *   3. 页数合理：一讲应该在 6 页以上（低于这个数说明内容被截断或渲染失败）
 *   4. 讲义正文里的固定小节都在（本节目标/动手任务/自测题/术语表），
 *      防止 Markdown 写好了但渲染环节把它们吃掉
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const courseDir = path.join(root, 'course')
const lessonsDir = path.join(courseDir, 'lessons')
const pdfDir = path.join(courseDir, 'pdf')

const results = []
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: String(detail) })

/** 数 PDF 页数：计算 /Type /Page 出现次数（排除 /Pages 这种父节点） */
function pdfPages(buffer) {
  const text = buffer.toString('latin1')
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

/** 读 PDF 里的内嵌字体数量：中文 PDF 必须内嵌字体，否则别的电脑打开是方框 */
function pdfFonts(buffer) {
  return (buffer.toString('latin1').match(/\/FontFile2|\/FontFile3|\/FontFile\b/g) ?? []).length
}

// ---------- 逐份讲义检查 ----------
const mdFiles = readdirSync(lessonsDir).filter((name) => name.endsWith('.md')).sort()
check('lessons 目录里有讲义', mdFiles.length > 0, `${mdFiles.length} 讲`)

/** 每讲必须出现的小节（用标题关键词判断，允许措辞略有差异） */
const requiredSections = [
  { key: '本节目标', patterns: ['本节目标'] },
  { key: '概念讲解', patterns: ['概念', '一、', '二、'] },
  { key: '动手任务', patterns: ['动手', '步骤'] },
  { key: '自测题', patterns: ['自测题'] },
  { key: '术语表', patterns: ['术语表'] }
]

for (const mdName of mdFiles) {
  const base = mdName.replace(/\.md$/, '')
  const markdown = readFileSync(path.join(lessonsDir, mdName), 'utf-8')
  const pdfPath = path.join(pdfDir, `${base}.pdf`)

  // 1. 生成物存在
  const exists = existsSync(pdfPath)
  const size = exists ? statSync(pdfPath).size : 0
  check(`PDF 已生成：${base}`, exists && size > 20000, `${(size / 1024).toFixed(1)} KB`)

  // 2. Markdown 自身的结构完整
  const missing = requiredSections.filter((section) => !section.patterns.some((p) => markdown.includes(p)))
  check(
    `Markdown 六段结构齐全：${base}`,
    missing.length === 0,
    missing.length ? `缺少：${missing.map((s) => s.key).join('、')}` : '目标/概念/动手/自测/术语表'
  )

  // 3. 正文长度（一讲 40 分钟，太短说明内容不足）
  const plain = markdown.replace(/```[\s\S]*?```/g, '').replace(/[#|>`*\-]/g, '')
  check(`正文长度足够：${base}`, plain.length > 2500, `${plain.length} 字`)

  // 4. PDF 内部结构
  if (exists && size > 20000) {
    const buffer = readFileSync(pdfPath)
    const pages = pdfPages(buffer)
    const fonts = pdfFonts(buffer)
    check(`页数合理（≥6 页）：${base}`, pages >= 6, `${pages} 页`)
    check(`内嵌了字体（换机器不变方框）：${base}`, fonts > 0, `${fonts} 个字体文件`)
  }
}

// ---------- 总纲 ----------
const syllabusMd = path.join(courseDir, '00-课程总纲.md')
const syllabusPdf = path.join(pdfDir, '00-课程总纲.pdf')
check('课程总纲已生成 PDF', existsSync(syllabusPdf) && statSync(syllabusPdf).size > 20000, (() => {
  return existsSync(syllabusPdf) ? `${(statSync(syllabusPdf).size / 1024).toFixed(1)} KB` : '缺失'
})())
if (existsSync(syllabusPdf)) {
  const pages = pdfPages(readFileSync(syllabusPdf))
  check('总纲页数合理（≥4 页）', pages >= 4, `${pages} 页`)
}
check('总纲列出了全部 24 讲', (() => {
  if (!existsSync(syllabusMd)) return false
  const text = readFileSync(syllabusMd, 'utf-8')
  // 目录表格里的讲次行形如： | 0-1 ✅ | 标题 | ... |   或   | 2-1 | 标题 | ... |
  // 写正则时要容忍「已完成」标记，否则加了 ✅ 之后这里会误报
  const lessons = (text.match(/^\|\s*\d+-\d+\s*(?:✅)?\s*\|/gm) ?? []).length
  return lessons >= 24
})(), '目录条目数')

// ---------- 汇总 ----------
const passed = results.filter((item) => item.ok).length
console.log(`\n===== 讲义自检：${passed}/${results.length} 通过 =====`)
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
process.exit(passed === results.length ? 0 : 1)
