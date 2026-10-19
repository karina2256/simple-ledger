import { BrowserWindow, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isQuitting } from './app-state'
import { resourcePath } from './paths'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#F4F6F8',
    title: '记账簿',
    icon: resourcePath('icons', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // 点 X：最小化到系统托盘，不退出。只有托盘菜单「退出」或系统关机才真的关掉
  win.on('close', (event) => {
    if (isQuitting()) return
    event.preventDefault()
    win.hide()
  })

  // 完全本地运行：不允许打开任何外部窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  // 开发期用于逐页冒烟：LEDGER_START_ROUTE=/accounts 可以直接打开指定路由
  const startRoute = process.env['LEDGER_START_ROUTE']
  // LEDGER_SHOT_URL：这个窗口改成加载外部网址（用于给官网自动拍照），
  // 只配合 LEDGER_PAGE_PROBE 使用，正常运行不受影响。
  const externalUrl = process.env['LEDGER_PAGE_PROBE'] === '1' ? process.env['LEDGER_SHOT_URL'] : undefined
  if (externalUrl) {
    void win.loadURL(externalUrl)
  } else if (devUrl) {
    void win.loadURL(startRoute ? `${devUrl}#${startRoute}` : devUrl)
  } else {
    void win.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      startRoute ? { hash: startRoute } : undefined
    )
  }

  win.on('closed', () => {
    mainWindow = null
  })

  // 开发期探针：配合 LEDGER_START_ROUTE，把「页面真的渲染出内容」这件事打印出来，
  // 免得「白屏但控制台干净」被当成通过；顺带截图存档，便于人工核对版面。
  //
  // LEDGER_SHOT_URL：换成截一个**外部网址**（官网等），同样走这个探针，
  // 这样官网也能被自动拍照，不靠人肉截图。
  if (process.env['LEDGER_PAGE_PROBE'] === '1') {
    const externalUrl = process.env['LEDGER_SHOT_URL']
    win.webContents.on('did-finish-load', () => {
      if (externalUrl) {
        // 外部网站没有应用的 bootstrap，等的是字体/图片就位
        setTimeout(() => {
          const shotDir = process.env['LEDGER_PROBE_DIR']
          if (!shotDir) return
          const shotName = process.env['LEDGER_PROBE_NAME'] ?? 'external'
          // 先回到顶部并让滚动揭示动画全部落地，否则截到的是「还没进场的空版式」
          void win.webContents
            .executeJavaScript(
              `(() => { window.scrollTo(0, 0);` +
                ` document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));` +
                ` const hero = document.querySelector('.hero__inner');` +
                ` const stat = document.querySelector('.stat__num');` +
                ` return JSON.stringify({` +
                `   title: (document.querySelector('.hero__title') || {}).className || 'MISSING',` +
                `   heroText: hero ? hero.innerText.replace(/\\s+/g,' ').slice(0, 80) : 'NO HERO',` +
                `   bodyBg: getComputedStyle(document.body).backgroundColor,` +
                `   statText: stat ? stat.innerText : 'NO STAT' }); })()`
            )
            .then((info: string) => console.log(`[page-probe] ${info}`))
            .catch((error: unknown) => console.log(`[page-probe] {"error":"${String(error)}"}`))
            .then(() => new Promise((resolve) => setTimeout(resolve, 900)))
            .then(() => {
              // capturePage 在这种「刚导航完」的场景下会拿到缓存帧（截出来是空版式），
              // 所以走 CDP 的 Page.captureScreenshot —— 它拿的是真实合成结果，
              // 还能用 captureBeyondViewport 一次拿到整页长图。
              const full = process.env['LEDGER_SHOT_FULL'] === '1'
              try {
                win.webContents.debugger.attach('1.3')
              } catch {
                /* 已经附加过就忽略 */
              }
              return win.webContents.debugger
                .sendCommand('Page.captureScreenshot', {
                  format: 'png',
                  captureBeyondViewport: full
                })
                .then((result: { data: string }) => {
                  mkdirSync(shotDir, { recursive: true })
                  const target = path.join(shotDir, `${shotName}${full ? '-full' : ''}.png`)
                  writeFileSync(target, Buffer.from(result.data, 'base64'))
                  console.log(`[page-shot] ${target}`)
                  try {
                    win.webContents.debugger.detach()
                  } catch {
                    /* ignore */
                  }
                })
                .catch(() => {
                  // CDP 不可用时退回 capturePage，至少留下一张
                  return win.webContents.capturePage().then((image) => {
                    mkdirSync(shotDir, { recursive: true })
                    const target = path.join(shotDir, `${shotName}.png`)
                    writeFileSync(target, image.toPNG())
                    console.log(`[page-shot-fallback] ${target}`)
                  })
                })
            })
            .catch(() => undefined)
        }, Number(process.env['LEDGER_SHOT_DELAY'] ?? 2600))
        return
      }

      // 等异步的 bootstrap / 列表请求落地，否则只能探到「正在打开记账簿…」
      setTimeout(() => {
        void win.webContents
          .executeJavaScript(
            `(() => { const root = document.getElementById('root');` +
              ` const main = document.querySelector('main');` +
              ` return JSON.stringify({ nodes: root ? root.children.length : 0,` +
              ` main: (main && main.innerText ? main.innerText : '').replace(/\\s+/g, ' ').slice(0, 90) }); })()`
          )
          .then((probe: string) => console.log(`[page-probe] ${probe}`))
          .catch((error: unknown) => console.log(`[page-probe] { "error": "${String(error)}" }`))

        const shotDir = process.env['LEDGER_PROBE_DIR']
        if (shotDir) {
          const shotName = process.env['LEDGER_PROBE_NAME'] ?? 'page'
          void win.webContents
            .capturePage()
            .then((image) => {
              mkdirSync(shotDir, { recursive: true })
              const target = path.join(shotDir, `${shotName}.png`)
              writeFileSync(target, image.toPNG())
              console.log(`[page-shot] ${target}`)
            })
            .catch(() => undefined)
        }
      }, 2500)
    })
  }

  mainWindow = win
  return win
}

export function focusMainWindow(): void {
  if (!mainWindow) {
    createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** 供托盘探针使用：直接走一遍点 X 的代码路径 */
export function requestClose(): void {
  mainWindow?.close()
}
