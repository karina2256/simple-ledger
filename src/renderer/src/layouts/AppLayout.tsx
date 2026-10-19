import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { formatCents } from '@shared/money'
import { useAppStore } from '../stores/app.store'
import { riseStyle, startThemeWipe, useCountUp, withViewTransition } from '../motion'
import { AppMark, Icon, type IconName } from '../components/Icon'
import { useGlobalShortcuts } from '../shortcuts'

/** 图标全部换成设计图标（原来是一串 emoji，那是界面「AI 味」最重的地方） */
const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/records', label: '记录', icon: 'records' },
  { to: '/billshot', label: '截图记账', icon: 'billshot' },
  { to: '/calendar', label: '日历', icon: 'calendar' },
  { to: '/stats', label: '汇总', icon: 'stats' },
  { to: '/search', label: '搜索', icon: 'search' },
  { to: '/budgets', label: '预算', icon: 'budgets' },
  { to: '/accounts', label: '账户', icon: 'accounts' },
  { to: '/categories', label: '分类', icon: 'categories' },
  { to: '/recurring', label: '周期记账', icon: 'recurring' },
  { to: '/recycle', label: '回收站', icon: 'trash' },
  { to: '/settings', label: '设置', icon: 'settings' }
]

/** 每个导航项的高度（h-9 = 2.25rem），指示条就是按这个步长移位的。
 *  不能用硬编码的 36px：界面字号档位会改根字号，rem 会跟着变，写死就会错位。 */
const NAV_ITEM_REM = 2.25

function navItemHeight(): number {
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return (Number.isFinite(root) ? root : 16) * NAV_ITEM_REM
}

export function AppLayout(): JSX.Element {
  const theme = useAppStore((state) => state.settings.theme)
  const setSetting = useAppStore((state) => state.setSetting)
  const accounts = useAppStore((state) => state.accounts)
  const location = useLocation()
  const navigate = useNavigate()

  const totalBalance = accounts.reduce((sum, account) => sum + account.balance, 0)
  // 账户合计跟着账变：存完一笔它会带过冲地弹到新数字，是「这一笔生效了」的即时回执
  const shownBalance = useCountUp(totalBalance, { spring: true })

  const activeIndex = NAV.findIndex((item) => location.pathname.startsWith(item.to))

  // 全局快捷键（Ctrl+N 新增、Ctrl+F 搜索、Ctrl+D 主题）
  useGlobalShortcuts()

  /** 主题切换：炫技档下从按钮位置做圆形擦除，其它档位直接换 */
  const toggleTheme = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const next = theme === 'dark' ? 'light' : 'dark'
    startThemeWipe(rect.left + rect.width / 2, rect.top + rect.height / 2, () => {
      void setSetting('theme', next)
    })
  }

  return (
    <div className="flex h-full">
      {/* 毛玻璃侧栏：底下那层流动渐变会透上来 */}
      <aside className="cinema-glass w-44 shrink-0 border-r border-line flex flex-col">
        <div className="h-14 flex items-center gap-2 px-4 border-b border-line">
          <AppMark size={24} />
          <span className="font-medium">记账簿</span>
        </div>
        <nav className="relative flex-1 py-2 overflow-y-auto">
          {/* 当前页指示条：整块弹簧滑动，而不是每一项各自闪一下背景色 */}
          <span
            aria-hidden="true"
            className="m-pill absolute left-2 right-2 top-2 h-9 rounded-lg bg-accent-soft"
            style={{
              transform: `translate3d(0, ${Math.max(activeIndex, 0) * navItemHeight()}px, 0)`,
              opacity: activeIndex < 0 ? 0 : 1
            }}
          />
          {NAV.map((item, index) => (
            <Link
              key={item.to}
              to={item.to}
              style={riseStyle(index)}
              // 声明式 HashRouter 不提供 View Transition 上下文（那是 RouterProvider 的能力），
              // 所以这里自己拦一次：flushSync 提交路由状态，浏览器就能拿到「旧/新」两帧做转场
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return
                event.preventDefault()
                if (activeIndex === index) return
                withViewTransition(() => navigate(item.to))
              }}
              className={[
                'm-rise cinema-nav-item cinema-nav-link relative flex items-center gap-2.5 mx-2 px-3 h-9 rounded-lg text-sm',
                activeIndex === index ? 'text-accent font-medium' : 'text-muted hover:bg-soft hover:text-main'
              ].join(' ')}
            >
              <span className="cinema-nav-icon flex w-5 justify-center">
                <Icon name={item.icon} size={20} active={activeIndex === index} />
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-line text-xs text-muted">
          <div className="flex justify-between">
            <span>账户合计</span>
            <span className="text-main tabular-nums">¥{formatCents(shownBalance)}</span>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="cinema-glass h-14 shrink-0 border-b border-line flex items-center justify-end px-5 gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="m-press cinema-sheen inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm text-muted hover:bg-soft hover:text-main"
            title="切换深色 / 浅色主题（Ctrl+D）"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
        </header>

        {/* cinema-scroller 提供 --page 滚动时间线：环境层视差、进度条、英雄区收缩都靠它 */}
        <main className="cinema-scroller flex-1 min-h-0 overflow-y-auto p-6">
          <div className="cinema-ambient" aria-hidden="true">
            <span className="cinema-blob cinema-blob--a" />
            <span className="cinema-blob cinema-blob--b" />
            <span className="cinema-blob cinema-blob--c" />
          </div>
          <div className="cinema-progress" aria-hidden="true" />

          {/* 换路由时整页重新落位；同路由内的 query 变化（日历翻月等）不重放 */}
          <div key={location.pathname} className="m-page cinema-content">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
