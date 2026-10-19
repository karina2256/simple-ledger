import { Menu, Tray, app, nativeImage } from 'electron'
import { resourcePath } from './paths'
import { markQuitting } from './app-state'
import { focusMainWindow, getMainWindow } from './window'

let tray: Tray | null = null
let iconEmpty = true

/** 托盘图标：简洁记账主题，多尺寸 ICO（16 / 24 / 32） */
function trayImagePath(): string {
  return resourcePath('icons', 'tray.ico')
}

export function trayMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  return [
    { label: '打开主界面', click: () => focusMainWindow() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        markQuitting()
        app.quit()
      }
    }
  ]
}

export function createTray(): Tray | null {
  if (tray) return tray
  try {
    const image = nativeImage.createFromPath(trayImagePath())
    iconEmpty = image.isEmpty()
    if (iconEmpty) {
      console.warn(`[tray] 托盘图标读取失败：${trayImagePath()}`)
    }
    tray = new Tray(iconEmpty ? nativeImage.createEmpty() : image)
  } catch (error) {
    console.warn(`[tray] 创建托盘失败：${String(error)}`)
    return null
  }

  tray.setToolTip('记账簿')
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()))

  // 左键单击：显示 / 隐藏主窗口
  tray.on('click', () => {
    const win = getMainWindow()
    if (!win) return focusMainWindow()
    if (win.isVisible() && !win.isMinimized()) win.hide()
    else focusMainWindow()
  })

  return tray
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

export function trayInfo(): { exists: boolean; iconEmpty: boolean; iconPath: string; menuLabels: string[] } {
  return {
    exists: tray !== null,
    iconEmpty,
    iconPath: trayImagePath(),
    menuLabels: trayMenuTemplate().filter((item) => item.type !== 'separator').map((item) => String(item.label))
  }
}
