/**
 * PDF 打印驱动（在 Electron 里运行，不是 Node）。
 *
 * 用法：electron pdf-driver.cjs <manifest.json>
 *
 * **一次进程只打印一份文档**（由外部脚本逐份调用）。
 *
 * 为什么这么设计：最早我把所有文档放在一个 Electron 进程里循环打印，
 * 结果第二份开始就报 ERR_FAILED (-2) —— 单独跑那一份却完全正常（493.5 KB）。
 * 也就是说错误和文档本身无关，是**连续创建/销毁隐藏窗口时渲染进程互相干扰**。
 * 与其在里面加各种等待和重试去赌时序，不如让每次打印都从干净进程开始：
 * 启动成本只有几百毫秒，换来的是 100% 可复现的成功率。
 *
 * 另外两个坑：
 *   - 不要用 win.loadFile()：对 Windows 中文路径会拼出坏 URL，报 ERR_FAILED。
 *     用 pathToFileURL() 生成规范 URL 再 loadURL()。
 *   - printBackground 必须为 true，否则表头灰底、引用块竖线、代码块底色全丢。
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync } = require('node:fs')
const { writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const path = require('node:path')

const [htmlPath, pdfPath] = process.argv.slice(2)

if (!htmlPath || !pdfPath) {
  console.error('用法：electron pdf-driver.cjs <输入.html> <输出.pdf>')
  app.exit(1)
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })

  let code = 0
  try {
    await win.loadURL(pathToFileURL(htmlPath).href)
    // 等排版稳定：本地字体无需等网络，但首帧布局需要一点时间
    await new Promise((resolve) => setTimeout(resolve, 600))

    // 强化分页保护：标题后面不要立刻断页，表格与代码块不要被劈开
    await win.webContents.executeJavaScript(`
      (() => {
        document.querySelectorAll('h1, h2, h3').forEach((el) => { el.style.breakAfter = 'avoid'; });
        document.querySelectorAll('table, pre, blockquote').forEach((el) => { el.style.breakInside = 'avoid'; });
        return true;
      })()
    `)

    const buffer = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      landscape: false,
      pageSize: 'A4'
    })
    await writeFile(pdfPath, buffer)
    console.log(`OK ${(buffer.length / 1024).toFixed(1)} KB`)
  } catch (error) {
    console.error(`FAIL ${error && error.message ? error.message : error}`)
    code = 1
  } finally {
    win.destroy()
  }

  app.exit(code)
})
