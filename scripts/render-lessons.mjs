/**
 * 讲义排版：Markdown → 一个自包含的精美 HTML（可直接浏览器打开，也可喂给 PDF 渲染）。
 *
 * 为什么自己写而不用 marked / markdown-it：
 *   讲义用到的语法就那几种（标题、列表、表格、代码、引用、粗体），
 *   自己实现不到 200 行，却省掉一个依赖，也方便把「讲义专用样式」直接编进渲染逻辑。
 *
 * 支持的语法（够用且明确）：
 *   # ## ### ####     标题
 *   ---               分隔线
 *   - / 1.            无序 / 有序列表（支持一层缩进）
 *   | a | b |         表格（第二行是 |---|---|）
 *   ```lang ... ```   代码块
 *   > 文字            引用块
 *   **粗体** `代码`   行内
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const courseDir = path.join(root, 'course')
const lessonsDir = path.join(courseDir, 'lessons')
const outDir = path.join(courseDir, 'out')
const pdfDir = path.join(courseDir, 'pdf')

/** 转义 HTML 特殊字符 */
function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 行内标记：行内代码、粗体 */
function inline(text) {
  let out = escapeHtml(text)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return out
}

/** 把一段 Markdown 转成 HTML 片段 */
export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html = []
  let index = 0

  const isTableSeparator = (line) => /^\|[\s:|-]+\|$/.test(line.trim())
  const splitCells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    // 代码块
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim()
      const body = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        body.push(lines[index])
        index += 1
      }
      index += 1
      html.push(
        `<pre class="code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(body.join('\n'))}</code></pre>`
      )
      continue
    }

    // 分隔线
    if (/^-{3,}$/.test(trimmed)) {
      html.push('<hr />')
      index += 1
      continue
    }

    // 标题
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    // 表格
    if (trimmed.startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const head = splitCells(line)
      index += 2
      const rows = []
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(splitCells(lines[index]))
        index += 1
      }
      html.push('<table><thead><tr>')
      head.forEach((cell) => html.push(`<th>${inline(cell)}</th>`))
      html.push('</tr></thead><tbody>')
      rows.forEach((row) => {
        html.push('<tr>')
        row.forEach((cell) => html.push(`<td>${inline(cell)}</td>`))
        html.push('</tr>')
      })
      html.push('</tbody></table>')
      continue
    }

    // 引用块（连续多行合并）
    if (trimmed.startsWith('>')) {
      const body = []
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        body.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      html.push(`<blockquote>${body.map((item) => inline(item)).join('<br />')}</blockquote>`)
      continue
    }

    // 列表（一层缩进作为子列表）
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items = []
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        const raw = lines[index]
        const indented = /^\s{2,}/.test(raw)
        const text = raw.replace(/^\s*([-*]|\d+\.)\s+/, '')
        if (indented && items.length > 0) {
          const last = items.pop()
          items.push(`${last}\n<ul class="sub"><li>${inline(text)}</li></ul>`)
        } else {
          items.push(inline(text))
        }
        index += 1
      }
      const tag = ordered ? 'ol' : 'ul'
      const rendered = items
        .map((item) => (item.includes('<ul class="sub">') ? `<li>${item.replace('\n', '')}</li>` : `<li>${item}</li>`))
        .join('')
      html.push(`<${tag}>${rendered}</${tag}>`)
      continue
    }

    // 空行
    if (trimmed === '') {
      index += 1
      continue
    }

    // 普通段落（连续非空、非特殊行合并）
    const paragraph = []
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !lines[index].trim().startsWith('#') &&
      !lines[index].trim().startsWith('|') &&
      !lines[index].trim().startsWith('>') &&
      !lines[index].trim().startsWith('```') &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[index]) &&
      !/^-{3,}$/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    html.push(`<p>${inline(paragraph.join(' '))}</p>`)
  }

  return html.join('\n')
}

/** 讲义样式：沿用记账簿的青色系，但为纸张/PDF 优化（白底深字、层次清晰） */
const STYLE = `
:root {
  --text: #1f2a33;
  --muted: #5f6e7c;
  --line: #e2e8ee;
  --soft: #f5f8fa;
  --accent: #2e9e93;
  --accent-soft: #eaf6f4;
  --code-bg: #f3f6f8;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--text);
  background: #fff;
  font-family: 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Segoe UI', system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.85;
}
.page { max-width: 780px; margin: 0 auto; padding: 46px 50px 70px; }
h1 { font-size: 27px; line-height: 1.35; margin: 0 0 6px; letter-spacing: -0.01em; }
h2 { font-size: 20px; margin: 38px 0 12px; padding-bottom: 8px; border-bottom: 2px solid var(--accent-soft); }
h3 { font-size: 17px; margin: 24px 0 8px; }
h4 { font-size: 15.5px; margin: 18px 0 6px; color: var(--muted); }
p { margin: 12px 0; }
strong { color: #16202a; }
hr { border: none; border-top: 1px solid var(--line); margin: 30px 0; }

blockquote {
  margin: 14px 0;
  padding: 13px 18px;
  background: var(--soft);
  border-left: 4px solid var(--accent);
  border-radius: 0 8px 8px 0;
  color: var(--muted);
  font-size: 14px;
}
blockquote strong { color: var(--text); }

code {
  background: var(--code-bg);
  padding: 2px 6px;
  border-radius: 5px;
  font-family: 'Cascadia Mono', Consolas, 'SF Mono', monospace;
  font-size: 13.5px;
  color: #0f5f58;
}
pre.code {
  background: var(--code-bg);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 14px 0;
  page-break-inside: avoid;
}
pre.code code {
  background: none;
  padding: 0;
  font-size: 13px;
  line-height: 1.7;
  color: #22303c;
  white-space: pre;
}

table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; page-break-inside: avoid; }
th, td { border: 1px solid var(--line); padding: 9px 12px; text-align: left; vertical-align: top; }
th { background: var(--soft); font-weight: 600; }
tbody tr:nth-child(even) { background: #fafcfd; }

ul, ol { margin: 12px 0; padding-left: 24px; }
li { margin: 6px 0; }
ul.sub { margin: 4px 0; padding-left: 20px; }
ul.sub li { font-size: 14px; color: var(--muted); }

@page { size: A4; margin: 14mm 12mm; }
@media print {
  .page { max-width: none; padding: 0; }
  h1, h2, h3 { page-break-after: avoid; }
  table, pre.code, blockquote { page-break-inside: avoid; }
}
`

export function buildLessonHtml({ title, markdown }) {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><div class="page">${renderMarkdown(markdown)}</div></body>
</html>`
}

function titleOf(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : fallback
}

/** 渲染所有讲义 → HTML，并把待转 PDF 的清单打成 JSON 给下一步用 */
export function renderAll() {
  mkdirSync(outDir, { recursive: true })
  mkdirSync(pdfDir, { recursive: true })
  const jobs = []

  const syllabusPath = path.join(courseDir, '00-课程总纲.md')
  try {
    const markdown = readFileSync(syllabusPath, 'utf-8')
    const htmlPath = path.join(outDir, '00-课程总纲.html')
    writeFileSync(htmlPath, buildLessonHtml({ title: '课程总纲', markdown }), 'utf-8')
    jobs.push({ htmlPath, pdfPath: path.join(pdfDir, '00-课程总纲.pdf'), title: '课程总纲' })
  } catch {
    /* 没有总纲文件就跳过 */
  }

  const files = readdirSync(lessonsDir)
    .filter((name) => name.endsWith('.md'))
    .sort()
  for (const name of files) {
    const markdown = readFileSync(path.join(lessonsDir, name), 'utf-8')
    const base = name.replace(/\.md$/, '')
    const htmlPath = path.join(outDir, `${base}.html`)
    writeFileSync(htmlPath, buildLessonHtml({ title: titleOf(markdown, base), markdown }), 'utf-8')
    jobs.push({ htmlPath, pdfPath: path.join(pdfDir, `${base}.pdf`), title: titleOf(markdown, base) })
  }

  return jobs
}

if (process.argv[1] && process.argv[1].endsWith('render-lessons.mjs')) {
  const jobs = renderAll()
  console.log(JSON.stringify({ count: jobs.length, jobs }))
}
