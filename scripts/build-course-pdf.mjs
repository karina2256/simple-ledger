/**
 * 生成讲义 PDF：Markdown → HTML → PDF（逐份用一个干净的 Electron 进程打印）。
 *
 * 用法：npm run course
 *
 * 输出：
 *   course/out/*.html   中间产物（可以直接用浏览器打开看排版）
 *   course/pdf/*.pdf    最终交付的讲义
 *
 * 为什么「一份一个进程」：见 scripts/pdf-driver.cjs 顶部注释。
 * 简单说就是同一个进程里连续打印时，第二份开始会报 ERR_FAILED，而单独跑却正常。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderAll } from './render-lessons.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const driver = path.join(root, 'scripts', 'pdf-driver.cjs')

if (!existsSync(electronExe)) {
  console.error('找不到 Electron，请先执行：npm install --ignore-scripts')
  process.exit(1)
}

const jobs = renderAll()
mkdirSync(path.dirname(jobs[0].pdfPath), { recursive: true })
console.log(`已渲染 ${jobs.length} 份 HTML，开始逐份打印 PDF…\n`)

const results = []
for (const job of jobs) {
  const run = spawnSync(electronExe, [driver, job.htmlPath, job.pdfPath], {
    encoding: 'utf-8',
    timeout: 120000
  })

  const exists = existsSync(job.pdfPath)
  const size = exists ? statSync(job.pdfPath).size : 0
  // 一份讲义正常在 30KB–3MB；小于 5KB 基本是空文档
  const ok = run.status === 0 && exists && size > 5000
  results.push({ title: job.title, file: path.basename(job.pdfPath), ok, size, detail: (run.stdout ?? '').trim() })

  console.log(`${ok ? '  ✓' : '  ✗'} ${path.basename(job.pdfPath)}  ${(size / 1024).toFixed(1)} KB`)
}

const passed = results.filter((item) => item.ok).length
console.log(`\n===== 讲义 PDF：${passed}/${results.length} 生成成功 =====`)
console.log(`输出目录：${path.join(root, 'course', 'pdf')}`)
process.exit(passed === results.length ? 0 : 1)
