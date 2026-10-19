import { useEffect, useRef } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { Toaster } from './components/Toaster'
import { OnboardingPage } from './features/onboarding/OnboardingPage'
import { RecordsPage } from './features/records/RecordsPage'
import { CalendarPage } from './features/calendar/CalendarPage'
import { RecurringPage } from './features/recurring/RecurringPage'
import { BillShotPage } from './features/billshot/BillShotPage'
import { SearchPage } from './features/search/SearchPage'
import { RecycleBinPage } from './features/recycle/RecycleBinPage'
import { StatsPage } from './features/stats/StatsPage'
import { BudgetsPage } from './features/budgets/BudgetsPage'
import { LockScreen } from './features/lock/LockScreen'
import { FONT_SCALE_PX } from './stores/app.store'
import { AccountsPage } from './features/accounts/AccountsPage'
import { CategoriesPage } from './features/categories/CategoriesPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { useAppStore } from './stores/app.store'
import { toastError } from './stores/toast.store'
import { AppMark } from './components/Icon'

export default function App(): JSX.Element {
  const ready = useAppStore((state) => state.ready)
  const initialized = useAppStore((state) => state.bootstrap?.initialized ?? false)
  const theme = useAppStore((state) => state.settings.theme)
  const motion = useAppStore((state) => state.settings.motion)
  const fontScale = useAppStore((state) => state.settings.fontScale)
  const locked = useAppStore((state) => state.locked)
  const load = useAppStore((state) => state.load)
  // 首次套用不该有过渡（否则启动瞬间整屏会从浅色「化」到深色）
  const themeApplied = useRef(false)

  useEffect(() => {
    load().catch(toastError)
  }, [load])

  // 动效档位写成 <html data-motion>，CSS 侧全靠它决定开哪一层
  useEffect(() => {
    document.documentElement.dataset['motion'] = motion ?? 'standard'
  }, [motion])

  // 界面字号：只改根字号，rem 会带着整站等比缩放
  useEffect(() => {
    document.documentElement.style.fontSize = `${FONT_SCALE_PX[fontScale ?? 'default']}px`
  }, [fontScale])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    if (!themeApplied.current) {
      themeApplied.current = true
      return
    }
    // 炫技档的主题切换由按钮触发 View Transition 圆形擦除，这里不要再叠一层颜色过渡
    if (root.dataset['motion'] === 'showcase') return
    root.classList.add('m-theme-anim')
    const timer = window.setTimeout(() => root.classList.remove('m-theme-anim'), 340)
    return () => window.clearTimeout(timer)
  }, [theme])

  if (!ready) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-muted text-sm">
        <AppMark size={40} className="m-breathe" />
        <span>正在打开记账簿…</span>
      </div>
    )
  }

  if (!initialized) {
    return (
      <>
        <OnboardingPage />
        <Toaster />
      </>
    )
  }

  // 应用锁：锁着的时候只渲染锁屏，其它内容不进 DOM
  if (locked) {
    return (
      <>
        <LockScreen />
        <Toaster />
      </>
    )
  }

  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/records" replace />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/recycle" element={<RecycleBinPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/billshot" element={<BillShotPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/records" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  )
}
