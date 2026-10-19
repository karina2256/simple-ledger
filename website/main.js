/* ============================================================
   记账簿官网 · 交互
   零依赖。所有动效都用原生观察器 + CSS，和软件本体一样不引第三方库。
   ============================================================ */
(function () {
  'use strict'

  /* ---------- 1. 下载地址 ----------
     这是唯一需要你改的地方：把 href 换成真实的安装包地址。
     支持三种填法：
       - GitHub Releases 直链（推荐，免费）
       - 你自己的对象存储（阿里云 OSS / 腾讯云 COS / Cloudflare R2）
       - 直接把安装包和本页放在同一个目录，用相对文件名
     没填真实地址时，按钮会跳到 #download 并提示「下载地址还没配好」，不会跳到 404。 */
  var DOWNLOADS = {
    portable: '',  // 例：'https://github.com/你的账号/记账簿/releases/download/v0.1.0/daily-ledger-0.1.0-portable.exe'
    setup: '',     // 例：'.../daily-ledger-0.1.0-setup.exe'
    msi: ''        // 例：'.../daily-ledger-0.1.0-installer.msi'
  }

  /* ---------- 2. 深浅色 ---------- */
  var html = document.documentElement
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)')
  var stored = null
  try { stored = localStorage.getItem('ledger-theme') } catch (e) { /* 隐私模式下可能不可用 */ }
  html.dataset.theme = stored || (prefersDark.matches ? 'dark' : 'light')

  document.getElementById('themeBtn').addEventListener('click', function (event) {
    var next = html.dataset.theme === 'dark' ? 'light' : 'dark'
    var apply = function () {
      html.dataset.theme = next
      try { localStorage.setItem('ledger-theme', next) } catch (e) { /* ignore */ }
    }
    // 有 View Transitions 就用圆形擦除（和软件里切主题的手感一致），否则直接换
    if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      var x = event.clientX, y = event.clientY
      var transition = document.startViewTransition(apply)
      transition.ready.then(function () {
        var radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
        html.animate(
          { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] },
          { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }
        )
      })
    } else {
      apply()
    }
  })

  /* ---------- 3. 滚动揭示（错峰） ---------- */
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'))
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var observer = new IntersectionObserver(function (entries) {
      var batch = entries.filter(function (entry) { return entry.isIntersecting })
      batch.forEach(function (entry, index) {
        var delay = Math.min(index * 70, 350)
        setTimeout(function () { entry.target.classList.add('is-in') }, delay)
        observer.unobserve(entry.target)
      })
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
    reveals.forEach(function (element) { observer.observe(element) })
  } else {
    reveals.forEach(function (element) { element.classList.add('is-in') })
  }

  /* ---------- 4. 顶部进度条 + 导航吸顶状态 ---------- */
  var bar = document.getElementById('progressBar')
  var nav = document.getElementById('nav')
  var ticking = false
  function onScroll() {
    if (ticking) return
    ticking = true
    requestAnimationFrame(function () {
      var max = document.documentElement.scrollHeight - innerHeight
      var ratio = max > 0 ? Math.min(scrollY / max, 1) : 0
      bar.style.transform = 'scaleX(' + ratio + ')'
      nav.classList.toggle('is-stuck', scrollY > 8)
      ticking = false
    })
  }
  addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  /* ---------- 5. 数字滚动 ----------
     初始 HTML 里就写着最终值：观察器没触发（比如 JS 被拦、或元素一开始就在视口外的边界情况）
     时也不会留下「0」这种明显错误的内容。JS 能跑才改成从 0 滚上去。 */
  var counters = Array.prototype.slice.call(document.querySelectorAll('[data-count]'))
  function runCounter(element) {
    var target = Number(element.dataset.count) || 0
    var duration = 900
    var start = performance.now()
    function step(now) {
      var progress = Math.min((now - start) / duration, 1)
      // 缓出：末段变慢，和软件里的弹簧数字观感一致
      var eased = 1 - Math.pow(1 - progress, 3)
      element.textContent = String(Math.round(target * eased))
      if (progress < 1) requestAnimationFrame(step)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.textContent = String(target)
      return
    }
    element.textContent = '0'
    requestAnimationFrame(step)
  }
  if ('IntersectionObserver' in window) {
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        runCounter(entry.target)
        counterObserver.unobserve(entry.target)
      })
    }, { threshold: 0.4 })
    counters.forEach(function (element) { counterObserver.observe(element) })
  }

  /* ---------- 6. 首屏卡片 3D 倾斜（跟随鼠标，轻微） ---------- */
  var tilt = document.querySelector('.tilt')
  if (tilt && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && matchMedia('(hover: hover)').matches) {
    var stage = tilt.parentElement
    stage.addEventListener('mousemove', function (event) {
      var rect = stage.getBoundingClientRect()
      var px = (event.clientX - rect.left) / rect.width - 0.5
      var py = (event.clientY - rect.top) / rect.height - 0.5
      tilt.style.transform = 'perspective(1200px) rotateY(' + (px * 5).toFixed(2) + 'deg) rotateX(' + (-py * 4).toFixed(2) + 'deg)'
    })
    stage.addEventListener('mouseleave', function () { tilt.style.transform = '' })
  }

  /* ---------- 7. 图片放大 ---------- */
  var lightbox = document.getElementById('lightbox')
  var lightboxImg = document.getElementById('lightboxImg')
  document.querySelectorAll('.shot').forEach(function (figure) {
    figure.addEventListener('click', function () {
      lightboxImg.src = figure.dataset.full || figure.querySelector('img').src
      lightboxImg.alt = figure.querySelector('img').alt
      lightbox.hidden = false
      document.body.style.overflow = 'hidden'
    })
  })
  function closeLightbox() {
    lightbox.hidden = true
    document.body.style.overflow = ''
  }
  document.getElementById('lightboxClose').addEventListener('click', closeLightbox)
  lightbox.addEventListener('click', function (event) { if (event.target === lightbox) closeLightbox() })
  addEventListener('keydown', function (event) { if (event.key === 'Escape' && !lightbox.hidden) closeLightbox() })

  /* ---------- 8. 下载按钮 ---------- */
  document.querySelectorAll('[data-download]').forEach(function (link) {
    var url = DOWNLOADS[link.dataset.download]
    if (url) {
      link.href = url
      link.setAttribute('rel', 'noopener')
      // 点了之后给一句反馈，别让用户以为没反应
      link.addEventListener('click', function () {
        var original = link.textContent
        link.textContent = '开始下载…'
        setTimeout(function () { link.textContent = original }, 2200)
      })
      return
    }
    // 还没配地址：不要跳到 404，原地说明
    link.addEventListener('click', function (event) {
      event.preventDefault()
      var tip = document.getElementById('dlTip')
      if (!tip) {
        tip = document.createElement('p')
        tip.id = 'dlTip'
        tip.style.cssText = 'margin:14px 0 0;padding:12px 16px;border-radius:12px;background:var(--c-soft);border:1px solid var(--c-line);font-size:14px;color:var(--c-muted)'
        link.closest('.dl').appendChild(tip)
      }
      tip.textContent = '下载地址还没配置：把 main.js 顶部 DOWNLOADS 里的三个链接换成真实安装包地址即可。'
    })
  })

  /* ---------- 9. 版本号 ---------- */
  // 和 electron-builder 的 version 对齐；改版本时改这一处
  document.getElementById('versionLabel').textContent = '0.1.0'
})()
