import { app } from 'electron'
import { trayInfo } from './tray'
import { focusMainWindow, getMainWindow, requestClose } from './window'
import { finishProbe, type ProbeResult } from './probe-report'

/**
 * 托盘行为探针：LEDGER_TRAY_PROBE=1 时自动走一遍
 * 「托盘存在 → 点 X → 窗口隐藏但进程还在 → 从托盘唤回」，打印结果后退出。
 * 这样打包出来的 exe 也能被自动验证，不用靠人点。
 */
export function runTrayProbe(): void {
  const results: ProbeResult[] = []
  const check = (name: string, ok: boolean, detail: unknown): void => {
    results.push({ name, ok, detail: String(detail) })
  }

  const win = getMainWindow()

  setTimeout(() => {
    const info = trayInfo()
    check('托盘已创建', info.exists, info.iconPath)
    check('托盘图标能读出内容（不是空图）', !info.iconEmpty, info.iconEmpty ? '空图标' : '正常')
    check('托盘菜单项正确', info.menuLabels.join('/') === '打开主界面/退出', info.menuLabels.join('/'))
    check('启动后主窗口可见', win?.isVisible() === true, win?.isVisible())

    // 等价于点右上角 X
    requestClose()

    setTimeout(() => {
      const current = getMainWindow()
      check('点 X 后窗口没被销毁', current !== null && !current.isDestroyed(), current === null ? '窗口没了' : '仍在')
      check('点 X 后窗口已隐藏', current?.isVisible() === false, current?.isVisible())
      check('点 X 后进程仍在运行（没有退出）', true, 'app 未 quit')

      // 等价于点托盘菜单「打开主界面」
      focusMainWindow()

      setTimeout(() => {
        const restored = getMainWindow()
        check('从托盘可以把窗口唤回', restored?.isVisible() === true, restored?.isVisible())
        check('唤回后窗口未最小化', restored?.isMinimized() === false, restored?.isMinimized())
        app.exit(finishProbe('托盘行为探针', results))
      }, 800)
    }, 800)
  }, 2600)
}
