import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 动效探针：截图只能证明「渲染出来了」，证明不了「动效挂上了、也没把内容卡在中间态」。
 *
 * 做法：把动效拆成几个可断言的步骤（首屏入场 → 路由切换 → 弹窗进场 → 校验抖动 →
 * 保存成功 → 弹窗退场 → 减少动态效果），每步注入一段采集脚本回收事实，判定放在主进程。
 * 步骤之间可以顺便截图（LEDGER_MOTION_SHOT_DIR），留下能看的证据。
 *
 * 触发方式：LEDGER_MOTION_PROBE=1（通常由 scripts/verify-motion.mjs 调起）。
 * 探针会在自己的临时数据目录里真记一笔 12.34 元，用来验证金额滚动。
 */

/** 第一步：注入工具函数与 animationstart 记录器，后续步骤复用 */
const INIT_JS = `(() => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  window.__vtCount = 0
  // 包一层 startViewTransition：这是判断「路由转场真的走了 View Transition」的唯一可靠依据
  const startViewTransition = document.startViewTransition
  if (typeof startViewTransition === 'function') {
    document.startViewTransition = function (...args) {
      window.__vtCount += 1
      return startViewTransition.apply(this, args)
    }
  }
  window.__m = {
    log: [],
    wait,
    vtCount: () => window.__vtCount,
    byText: (selector, text) =>
      Array.from(document.querySelectorAll(selector)).find((el) => (el.textContent || '').trim().indexOf(text) >= 0),
    setInput: (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    setSelect: (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(el, value)
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },
    selectByLabel: (text) => {
      const label = Array.from(document.querySelectorAll('.m-dialog-in label')).find((el) => {
        const first = el.querySelector('span')
        return first && (first.textContent || '').trim() === text
      })
      return label ? label.querySelector('select') : null
    },
    balanceText: () => {
      const aside = document.querySelector('aside')
      const row = aside ? aside.querySelector('.border-t') : null
      return row ? (row.textContent || '').replace(/\\s+/g, ' ') : ''
    },
    // 把「账户合计 ¥107,498.20」解析成数值，用来判断弹簧是不是冲过了目标
    balanceNumber: () => {
      const text = window.__m.balanceText().replace(/[^\\d.-]/g, '')
      return text ? Number(text) : null
    },
    // 滚动/视图时间线驱动的动画不随时间走，不能被当成「没播完」
    scrollDriven: (animation) => {
      const name = animation.timeline && animation.timeline.constructor ? animation.timeline.constructor.name : ''
      return name.indexOf('Scroll') >= 0 || name.indexOf('View') >= 0
    },
    isTimeDriven: (animation) => {
      if (window.__m.scrollDriven(animation)) return false
      try {
        return animation.effect.getTiming().iterations !== Infinity
      } catch (error) {
        return true
      }
    },
    /** 元素上的动画是不是滚动/视图时间线驱动的（只看真实 Animation 对象，不看计算值里的名字） */
    timelineKinds: (el) => {
      if (!el) return ''
      return el
        .getAnimations()
        .map((a) => (a.timeline && a.timeline.constructor ? a.timeline.constructor.name : '?'))
        .join(',')
    },
    /** 位移是否已经落回原位（弹簧会留下 1e-15 量级的浮点残渣，不能要求严格等于单位矩阵） */
    settledTransform: (el) => {
      const transform = getComputedStyle(el).transform
      if (transform === 'none') return true
      const parts = transform.slice(transform.indexOf('(') + 1, -1).split(',').map(Number)
      const near = (value, target) => Math.abs(value - target) < 0.02
      if (transform.indexOf('matrix3d') === 0) {
        return parts.every((value, index) => (index % 5 === 0 ? near(value, 1) : near(value, 0)))
      }
      return parts.every((value, index) => (index === 0 || index === 3 ? near(value, 1) : near(value, 0)))
    }
  }
  document.addEventListener('animationstart', (event) => window.__m.log.push(event.animationName), true)
  return 'ok'
})()`

/** 首屏：等时间驱动的动画静止，再检查有没有元素停在半路；顺带采集炫技层的落地情况 */
const SETTLE_JS = `(async () => {
  const m = window.__m
  for (let i = 0; i < 80; i += 1) {
    const busy = document.getAnimations().some((a) => a.playState === 'running' && m.isTimeDriven(a))
    if (!busy && i > 4) break
    await m.wait(50)
  }
  const out = { entrance: m.log.slice() }
  const animated = Array.from(document.querySelectorAll('.m-rise, .m-page, .m-view'))
  out.settle = {
    total: animated.length,
    stuck: animated
      .filter((el) => {
        // 带滚动驱动动画的元素本来就随滚动位置变化，不算卡住
        if (el.getAnimations().some((a) => m.scrollDriven(a))) return false
        return Number(getComputedStyle(el).opacity) < 0.99 || !m.settledTransform(el)
      })
      .map((el) => {
        const style = getComputedStyle(el)
        return el.className + ' [opacity=' + style.opacity + ' transform=' + style.transform + ']'
      })
      .slice(0, 5)
  }

  // ---- 炫技层是否真的挂上了 ----
  const aside = document.querySelector('aside')
  const scroller = document.querySelector('main')
  out.cinema = {
    motion: document.documentElement.dataset.motion || null,
    blobs: document.querySelectorAll('.cinema-blob').length,
    blobBlur: (() => {
      const blob = document.querySelector('.cinema-blob')
      return blob ? getComputedStyle(blob).filter : null
    })(),
    glass: aside ? getComputedStyle(aside).backdropFilter || getComputedStyle(aside).webkitBackdropFilter : null,
    glassAlpha: aside ? getComputedStyle(aside).backgroundColor : null,
    scrollerTimeline: scroller ? getComputedStyle(scroller).scrollTimelineName : null,
    // 时间线的「类型」要看真实 Animation 对象，计算值里只会显示 --page 这个名字
    ambientTimelines: m.timelineKinds(document.querySelector('.cinema-ambient')),
    ambientTimelineName: (() => {
      const el = document.querySelector('.cinema-ambient')
      return el ? getComputedStyle(el).animationTimeline : null
    })(),
    progressTimelines: m.timelineKinds(document.querySelector('.cinema-progress')),
    progressExists: Boolean(document.querySelector('.cinema-progress')),
    heroTimelines: m.timelineKinds(document.querySelector('.cinema-hero')),
    heroSticky: (() => {
      const hero = document.querySelector('.cinema-hero')
      return hero ? getComputedStyle(hero).position : null
    })(),
    revealTimelines: m.timelineKinds(document.querySelector('.cinema-reveal')),
    tiltReady: Boolean(document.querySelector('.cinema-tilt')),
    springEasingUsed: getComputedStyle(document.documentElement).getPropertyValue('--x-snappy').trim().slice(0, 7),
    // 动效层不许挤坏布局：日期列是固定 w-28（112px），一旦被压窄就会折行、行高翻倍
    tableLayout: (() => {
      const table = document.querySelector('table')
      if (!table) return null
      const row = table.querySelector('tbody tr')
      const cell = row ? row.querySelector('td') : null
      return {
        firstCellWidth: cell ? Math.round(cell.getBoundingClientRect().width) : null,
        rowHeight: row ? Math.round(row.getBoundingClientRect().height) : null
      }
    })()
  }
  m.log.length = 0
  return JSON.stringify(out)
})()`

/** 路由切换 + 弹窗进场 */
const MODAL_JS = `(async () => {
  const m = window.__m
  const out = {}
  const calendar = m.byText('aside a', '日历')
  if (calendar) calendar.click()
  await m.wait(800)
  out.navLog = m.log.slice()
  m.log.length = 0

  const records = m.byText('aside a', '记录')
  if (records) records.click()
  await m.wait(800)
  m.log.length = 0

  const add = m.byText('button', '新增记录')
  if (add) add.click()
  // 先取动画进行中的形变（证明是位移+缩放而不是纯淡入），再等弹簧收住取最终透明度
  await m.wait(200)
  out.enter = m.log.slice()
  const dialog = document.querySelector('.m-dialog-in, .m-dialog-out')
  out.transform = dialog ? getComputedStyle(dialog).transform : null
  await m.wait(620)
  const settledDialog = document.querySelector('.m-dialog-in, .m-dialog-out')
  out.opacity = settledDialog ? getComputedStyle(settledDialog).opacity : null
  m.log.length = 0
  return JSON.stringify(out)
})()`

/** 校验失败：金额留空直接保存 → 抖动 + 错误提示条 */
const INVALID_JS = `(async () => {
  const m = window.__m
  const amount = document.querySelector('.m-dialog-in input[inputmode="decimal"]') ||
    document.querySelector('input[inputmode="decimal"]')
  if (amount) m.setInput(amount, '')
  const save = m.byText('.m-dialog-in button', '保存')
  if (save) save.click()
  // 抖动只有 360ms，必须在动画进行中取样：终态时 transform 已经回到 none
  await m.wait(140)
  const shaking = document.querySelector('.m-shake')
  const out = {
    transform: shaking ? getComputedStyle(shaking).transform : null,
    running: shaking ? shaking.getAnimations().some((animation) => animation.playState === 'running') : false
  }
  await m.wait(340)
  out.log = m.log.slice()
  out.errorToast = Boolean(document.querySelector('.m-toast-error'))
  m.log.length = 0
  return JSON.stringify(out)
})()`

/** 记账成功：填金额 + 选分类（非转账必须选分类）→ 成功提示条 + 对勾 + 金额滚动 */
const SUCCESS_JS = `(async () => {
  const m = window.__m
  const amount = document.querySelector('input[inputmode="decimal"]')
  if (amount) m.setInput(amount, '12.34')
  const category = m.selectByLabel('分类')
  let picked = null
  if (category) {
    const option = Array.from(category.options).find((item) => item.value !== '')
    if (option) {
      m.setSelect(category, option.value)
      picked = option.textContent.trim()
    }
  }
  await m.wait(60)

  const before = m.balanceText()
  const beforeNumber = m.balanceNumber()
  const save = m.byText('.m-dialog-in button', '保存')
  if (save) save.click()
  const samples = []
  const numbers = []
  for (let i = 0; i < 24; i += 1) {
    await m.wait(30)
    samples.push(m.balanceText())
    numbers.push(m.balanceNumber())
  }

  const out = {
    log: m.log.slice(),
    pickedCategory: picked,
    before,
    after: m.balanceText(),
    samples,
    numbers,
    beforeNumber,
    afterNumber: m.balanceNumber(),
    distinct: Array.from(new Set(samples)).length,
    checkDrawn: Boolean(document.querySelector('.m-draw')),
    // 庆祝层：粒子 + 光环
    burstParticles: document.querySelectorAll('.cinema-burst i').length,
    burstRing: Boolean(document.querySelector('.cinema-ring')),
    dialogClosed: !document.querySelector('.m-dialog-in, .m-dialog-out'),
    toastTexts: Array.from(document.querySelectorAll('[class*="m-toast"]'))
      .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
  }
  m.log.length = 0
  return JSON.stringify(out)
})()`

/** 炫技层交互：卡片倾斜、路由 View Transition、主题圆形擦除 */
const CINEMATIC_JS = `(async () => {
  const m = window.__m
  const out = {}

  // 1) 光标追踪：往第一张可倾斜卡片上派发 pointermove，看 CSS 变量有没有写进去
  const card = document.querySelector('.cinema-tilt')
  if (card) {
    const rect = card.getBoundingClientRect()
    card.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: rect.left + rect.width * 0.2,
      clientY: rect.top + rect.height * 0.2
    }))
    await m.wait(120)
    out.tiltX = card.style.getPropertyValue('--tilt-x')
    out.tiltY = card.style.getPropertyValue('--tilt-y')
    out.specX = card.style.getPropertyValue('--mx')
  }

  // 2) 路由转场：点侧栏「日历」，统计 startViewTransition 调用次数
  const before = m.vtCount()
  const calendar = m.byText('aside a', '日历')
  if (calendar) calendar.click()
  await m.wait(900)
  out.navVt = m.vtCount() - before
  out.navAnimations = document.getAnimations().map((a) => {
    const pseudo = a.effect && a.effect.pseudoElement ? a.effect.pseudoElement : ''
    return pseudo
  }).filter(Boolean).slice(0, 6)
  m.log.length = 0

  // 3) 主题圆形擦除：点右上角主题按钮
  const themeButton = m.byText('header button', '深色') || m.byText('header button', '浅色')
  const themeBefore = m.vtCount()
  out.themeInitial = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  if (themeButton) themeButton.click()
  await m.wait(90)
  out.wipeClass = document.documentElement.classList.contains('cinema-theme-wipe')
  out.wipeX = document.documentElement.style.getPropertyValue('--wipe-x')
  out.themeVt = m.vtCount() - themeBefore
  await m.wait(900)
  out.wipeCleared = !document.documentElement.classList.contains('cinema-theme-wipe')
  out.themeNow = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  // 切回去，别影响后面的截图
  if (themeButton) themeButton.click()
  await m.wait(900)
  out.themeRestored = document.documentElement.classList.contains('dark') ? 'dark' : 'light'

  return JSON.stringify(out)
})()`

/** 滚动起来：验证英雄区收缩、进度条增长、环境层与内容拉出纵深 */
const SCROLL_JS = `(async () => {
  const m = window.__m
  const main = document.querySelector('main')
  const hero = document.querySelector('.cinema-hero')
  const progress = document.querySelector('.cinema-progress')
  const scaleOf = (el) => {
    if (!el) return null
    const transform = getComputedStyle(el).transform
    if (transform === 'none') return 1
    const parts = transform.slice(transform.indexOf('(') + 1, -1).split(',').map(Number)
    return transform.indexOf('matrix3d') === 0 ? Math.round(parts[0] * 1000) / 1000 : Math.round(parts[0] * 1000) / 1000
  }
  const out = {
    scrollable: main ? main.scrollHeight > main.clientHeight + 4 : false,
    heroScaleTop: scaleOf(hero),
    progressTop: scaleOf(progress)
  }
  if (main) {
    main.scrollTop = 520
    await m.wait(320)
    out.scrolled = main.scrollTop
    out.heroScale = scaleOf(hero)
    out.heroBlur = hero ? getComputedStyle(hero).filter : null
    out.progressScale = scaleOf(progress)
    out.progressWidth = progress ? Math.round(progress.getBoundingClientRect().width) : null
  }
  return JSON.stringify(out)
})()`

/** 弹窗退场：重开一次再按 Esc，应当能看到 m-dialog-out，且播完才卸载 */
const EXIT_JS = `(async () => {
  const m = window.__m
  const main = document.querySelector('main')
  if (main) main.scrollTop = 0
  await m.wait(200)
  const add = m.byText('button', '新增记录')
  if (add) add.click()
  await m.wait(400)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await m.wait(120)
  const out = { log: m.log.slice(), stillMounted: Boolean(document.querySelector('.m-dialog-out')) }
  await m.wait(300)
  out.unmounted = !document.querySelector('.m-dialog-in, .m-dialog-out')
  return JSON.stringify(out)
})()`

/** 减少动态效果：系统开了这个偏好之后，动画应当被压到瞬间完成 */
const REDUCED_JS = `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  for (let i = 0; i < 40; i += 1) {
    if (document.querySelector('.m-page')) break
    await wait(50)
  }
  const page = document.querySelector('.m-page')
  const rise = document.querySelector('.m-rise')
  return JSON.stringify({
    matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    pageDuration: page ? getComputedStyle(page).animationDuration : null,
    riseDuration: rise ? getComputedStyle(rise).animationDuration : null,
    pageOpacity: page ? getComputedStyle(page).opacity : null,
    riseDelay: rise ? getComputedStyle(rise).animationDelay : null
  })
})()`

interface StepFacts {
  entrance?: string[]
  settle?: { total: number; stuck: string[] }
  cinema?: Record<string, unknown>
  navLog?: string[]
  enter?: string[]
  opacity?: string | null
  transform?: string | null
  running?: boolean
  log?: string[]
  errorToast?: boolean
  pickedCategory?: string | null
  before?: string
  after?: string
  samples?: string[]
  numbers?: (number | null)[]
  beforeNumber?: number | null
  afterNumber?: number | null
  distinct?: number
  checkDrawn?: boolean
  burstParticles?: number
  burstRing?: boolean
  dialogClosed?: boolean
  toastTexts?: string[]
  stillMounted?: boolean
  unmounted?: boolean
  tiltX?: string
  tiltY?: string
  specX?: string
  navVt?: number
  navAnimations?: string[]
  wipeClass?: boolean
  wipeX?: string
  themeVt?: number
  themeInitial?: string
  wipeCleared?: boolean
  themeNow?: string
  themeRestored?: string
  scrollable?: boolean
  scrolled?: number
  heroScaleTop?: number
  heroScale?: number
  heroBlur?: string | null
  progressTop?: number
  progressScale?: number
  progressWidth?: number | null
}

interface ReducedFacts {
  matches: boolean
  pageDuration: string | null
  riseDuration: string | null
  pageOpacity: string | null
  riseDelay: string | null
}

export async function runMotionProbe(win: BrowserWindow): Promise<number> {
  const results: { name: string; ok: boolean; detail: string }[] = []
  const check = (name: string, ok: boolean, detail: unknown): void => {
    results.push({ name, ok, detail: String(detail) })
  }

  /** 已经加载完就别再等事件了，否则 once 会一直挂住 */
  const waitForLoad = (): Promise<void> =>
    win.webContents.isLoading()
      ? new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
      : Promise.resolve()

  const run = async <T>(script: string): Promise<T> => JSON.parse((await win.webContents.executeJavaScript(script)) as string) as T

  const shots: string[] = []
  const shoot = async (name: string): Promise<void> => {
    const dir = process.env['LEDGER_MOTION_SHOT_DIR']
    if (!dir) return
    try {
      const image = await win.webContents.capturePage()
      mkdirSync(dir, { recursive: true })
      const target = path.join(dir, `${name}.png`)
      writeFileSync(target, image.toPNG())
      shots.push(target)
    } catch (error) {
      // 截图失败不影响断言结果，但要说清楚为什么没留图
      shots.push(`[截图失败 ${name}] ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  try {
    await waitForLoad()
    await win.webContents.executeJavaScript(INIT_JS)

    // ---- 1. 首屏入场与终态 ----
    const settle = await run<StepFacts>(SETTLE_JS)
    const entrance = settle.entrance ?? []
    const settled = settle.settle ?? { total: 0, stuck: [] }
    check(
      '首屏入场动画有触发',
      entrance.length > 0 || settled.total > 0,
      entrance.length > 0 ? entrance.join(',') : `未捕获动画名，但页面上有 ${settled.total} 个带动效元素`
    )
    check(
      '入场动画全部收在终态（没有卡在半透明 / 残留位移）',
      settled.stuck.length === 0,
      `${settled.total} 个带动效元素，未归位 ${settled.stuck.length} 个 ${settled.stuck.join(' | ')}`
    )

    // ---- 炫技层是否真的落地 ----
    const cinema = (settle.cinema ?? {}) as Record<string, string | number | boolean | null>
    const onScrollTimeline = (kind: string): boolean => kind.includes('Scroll') || kind.includes('View')
    check('炫技档已生效（data-motion）', cinema['motion'] === 'showcase', String(cinema['motion']))
    check(
      '环境渐变层在位且有虚化',
      Number(cinema['blobs']) >= 3 && String(cinema['blobBlur']).includes('blur'),
      `${String(cinema['blobs'])} 个光斑，filter=${String(cinema['blobBlur'])}`
    )
    check(
      '环境层视差接上了滚动时间线',
      onScrollTimeline(String(cinema['ambientTimelines'])),
      `timeline=${String(cinema['ambientTimelines'])}（名字 ${String(cinema['ambientTimelineName'])}）`
    )
    check(
      '滚动进度条接上了滚动时间线',
      cinema['progressExists'] === true && onScrollTimeline(String(cinema['progressTimelines'])),
      `timeline=${String(cinema['progressTimelines'])}`
    )
    check(
      '英雄区钉在顶部并接上滚动时间线',
      cinema['heroSticky'] === 'sticky' && onScrollTimeline(String(cinema['heroTimelines'])),
      `position=${String(cinema['heroSticky'])} timeline=${String(cinema['heroTimelines'])}`
    )
    check(
      '卡片揭示用的是 view() 时间线',
      onScrollTimeline(String(cinema['revealTimelines'])),
      `timeline=${String(cinema['revealTimelines'])}`
    )
    check(
      '毛玻璃生效（侧栏半透明 + 背景虚化）',
      String(cinema['glass']).includes('blur') && String(cinema['glassAlpha']).includes('color('),
      `backdrop=${String(cinema['glass'])} 背景=${String(cinema['glassAlpha'])}`
    )
    check(
      '弹簧曲线已就位（linear() 手写）',
      String(cinema['springEasingUsed']).includes('linear'),
      String(cinema['springEasingUsed'])
    )
    const tableLayout = (cinema['tableLayout'] ?? null) as { firstCellWidth: number; rowHeight: number } | null
    check(
      '动效层没有挤坏表格列宽',
      tableLayout === null || (tableLayout.firstCellWidth >= 110 && tableLayout.rowHeight <= 48),
      tableLayout
        ? `日期列 ${tableLayout.firstCellWidth}px（应为 112），行高 ${tableLayout.rowHeight}px（折行会涨到 60+）`
        : '页面上没有表格，跳过'
    )

    // ---- 2. 路由切换 ----
    const modal = await run<StepFacts>(MODAL_JS)
    const navLog = modal.navLog ?? []
    check(
      '切换路由时整页有转场',
      navLog.includes('m-page') || navLog.includes('cinema-page-in'),
      navLog.join(',') || '（无）'
    )
    check('切换路由时页面内容有入场', navLog.includes('m-view') || navLog.includes('m-rise'), navLog.join(',') || '（无）')

    // ---- 3. 弹窗进场 ----
    const enter = modal.enter ?? []
    check(
      '弹窗进场是「位移 + 缩放」而不只是淡入',
      (enter.includes('m-dialog-in') || enter.includes('cinema-sheet-in')) &&
        String(modal.transform) !== 'none' &&
        String(modal.transform).length > 0,
      `animation=${enter.join(',')} transform=${String(modal.transform)}`
    )
    check('弹窗进场结束时完全不透明', Number(modal.opacity) >= 0.99, String(modal.opacity))
    await shoot('motion-dialog')

    // ---- 4. 校验失败 ----
    const invalid = await run<StepFacts>(INVALID_JS)
    check(
      '金额校验失败会抖一下',
      (invalid.log ?? []).includes('m-shake') && invalid.running === true && String(invalid.transform) !== 'none',
      `animation=${(invalid.log ?? []).join(',')} 抖动中=${String(invalid.running)} transform=${String(invalid.transform)}`
    )
    check('金额校验失败会出错误提示条（带震荡）', invalid.errorToast === true, String(invalid.errorToast))
    await shoot('motion-invalid')

    // ---- 5. 记账成功 ----
    const success = await run<StepFacts>(SUCCESS_JS)
    const toastTexts = (success.toastTexts ?? []).join(' | ')
    check(
      '保存成功后提示条滑入',
      (success.log ?? []).some((name) => name === 'm-toast-in' || name === 'cinema-toast-in'),
      `${(success.log ?? []).join(',')} 提示内容：${toastTexts}`
    )
    check('成功提示条带对勾描线', success.checkDrawn === true, String(success.checkDrawn))
    check('保存后弹窗正常关闭', success.dialogClosed === true, `${String(success.dialogClosed)} 提示内容：${toastTexts}`)
    check(
      '账户合计是逐帧滚到新数字的',
      Number(success.distinct) >= 3,
      `${String(success.before)} → ${String(success.after)}，采样到 ${String(success.distinct)} 个中间值${success.pickedCategory ? `（分类：${success.pickedCategory}）` : ''}`
    )
    // 弹簧过冲：中途应当冲过终点，再回落到目标值（ease-out 是不会越过去的）
    const fromNumber = Number(success.beforeNumber)
    const toNumber = Number(success.afterNumber)
    const travel = toNumber - fromNumber
    const overshot =
      Number.isFinite(travel) &&
      travel !== 0 &&
      (success.numbers ?? []).some((value) => typeof value === 'number' && Math.sign(value - toNumber) === Math.sign(travel) && Math.abs(value - toNumber) > 0.001)
    check(
      '金额滚动带弹簧过冲（冲过目标再回落）',
      overshot,
      `${String(fromNumber)} → ${String(toNumber)}，采样：${(success.numbers ?? []).slice(0, 24).join(', ')}`
    )
    check(
      '成功提示条有粒子爆发与光环',
      Number(success.burstParticles) >= 10 && success.burstRing === true,
      `粒子 ${String(success.burstParticles)} 颗，光环 ${String(success.burstRing)}`
    )
    await shoot('motion-success')

    // ---- 6. 滚动驱动：英雄区收缩 + 进度条增长 ----
    const scroll = await run<StepFacts>(SCROLL_JS)
    check(
      '滚动时英雄区收缩并虚化（钉住效果）',
      scroll.scrollable === false ||
        (Number(scroll.heroScale) < 0.99 && String(scroll.heroBlur).includes('blur')),
      `滚动到 ${String(scroll.scrolled)}px：scale ${String(scroll.heroScaleTop)} → ${String(scroll.heroScale)}，filter=${String(scroll.heroBlur)}`
    )
    check(
      '滚动进度条随滚动增长（静止时为 0）',
      scroll.scrollable === false ||
        (Number(scroll.progressTop) <= 0.01 && Number(scroll.progressScale) > 0.05),
      `scaleX ${String(scroll.progressTop)} → ${String(scroll.progressScale)}`
    )
    await shoot('motion-scrolled')

    // ---- 7. 弹窗退场 ----
    const exit = await run<StepFacts>(EXIT_JS)
    check(
      '弹窗退场也是动画（不是直接消失）',
      (exit.log ?? []).some((name) => name === 'm-dialog-out' || name === 'cinema-sheet-out') &&
        exit.stillMounted === true,
      `animation=${(exit.log ?? []).join(',')} 退场期间仍挂载=${String(exit.stillMounted)}`
    )
    check('退场动画播完才卸载', exit.unmounted === true, String(exit.unmounted))

    // ---- 8. 炫技层交互：倾斜 / 路由转场 / 主题擦除 ----
    const cine = await run<StepFacts>(CINEMATIC_JS)
    check(
      '卡片光标追踪（3D 倾斜 + 高光变量）',
      Boolean(cine.tiltX) && Boolean(cine.specX),
      `--tilt-x=${String(cine.tiltX)} --tilt-y=${String(cine.tiltY)} --mx=${String(cine.specX)}`
    )
    check(
      '路由切换走的是 View Transition',
      Number(cine.navVt) >= 1,
      `startViewTransition 调用 ${String(cine.navVt)} 次，转场期间伪元素=${(cine.navAnimations ?? []).join(',') || '（已结束）'}`
    )
    check(
      '主题切换是圆形擦除（且是 View Transition）',
      cine.wipeClass === true && Number(cine.themeVt) >= 1 && Boolean(cine.wipeX),
      `擦除中=${String(cine.wipeClass)} 起点 x=${String(cine.wipeX)} vt=${String(cine.themeVt)}`
    )
    check(
      '擦除结束后类名清掉、主题切过去又切回来',
      cine.wipeCleared === true &&
        cine.themeNow !== cine.themeInitial &&
        cine.themeRestored === cine.themeInitial,
      `擦除类已清=${String(cine.wipeCleared)} 初始=${String(cine.themeInitial)} 切换后=${String(cine.themeNow)} 还原后=${String(cine.themeRestored)}`
    )

    // ---- 9. 减少动态效果 ----
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })
    // reload 之后同 tick 挂监听：加载事件不可能在这之前触发
    const loaded = new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
    win.webContents.reload()
    await loaded

    const reduced = await run<ReducedFacts>(REDUCED_JS)
    check('系统偏好能被页面读到', reduced.matches === true, String(reduced.matches))
    check(
      '减少动态效果时动画时长被压到 0',
      parseFloat(reduced.pageDuration ?? '1') < 0.05 && parseFloat(reduced.riseDuration ?? '1') < 0.05,
      `page=${String(reduced.pageDuration)} rise=${String(reduced.riseDuration)}`
    )
    check(
      '减少动态效果时不推迟、内容直接可见',
      parseFloat(reduced.riseDelay ?? '1') < 0.01 && Number(reduced.pageOpacity) >= 0.99,
      `delay=${String(reduced.riseDelay)} opacity=${String(reduced.pageOpacity)}`
    )
    win.webContents.debugger.detach()
  } catch (error) {
    check('探针执行完成', false, error instanceof Error ? error.message : String(error))
  }

  const passed = results.filter((item) => item.ok).length
  console.log(`\n===== 动效探针：${passed}/${results.length} 通过 =====`)
  for (const item of results) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
  }
  for (const shot of shots) console.log(`[motion-shot] ${shot}`)

  return passed === results.length ? 0 : 1
}
