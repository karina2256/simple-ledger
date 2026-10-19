/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        app: 'var(--c-bg)',
        card: 'var(--c-card)',
        soft: 'var(--c-soft)',
        line: 'var(--c-line)',
        main: 'var(--c-text)',
        muted: 'var(--c-muted)',
        accent: 'var(--c-accent)',
        'accent-soft': 'var(--c-accent-soft)',
        danger: 'var(--c-danger)',
        warn: 'var(--c-warn)',
        ok: 'var(--c-ok)',
        income: 'var(--c-income)',
        expense: 'var(--c-expense)'
      },
      borderRadius: {
        card: '14px'
      },
      // 动效 token：与 index.css 里的 --m-* 变量保持同一套口径。
      // 时长三档 quick / standard / slow，缓动按「入场减速、退场加速、屏内对称」分工。
      transitionTimingFunction: {
        'm-std': 'cubic-bezier(0.2, 0, 0, 1)',
        'm-out': 'cubic-bezier(0.05, 0.7, 0.1, 1)',
        'm-in': 'cubic-bezier(0.3, 0, 1, 1)',
        'm-back': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)'
      },
      transitionDuration: {
        'm-quick': '120ms',
        'm-std': '220ms',
        'm-slow': '320ms'
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 8px 24px -12px rgba(16,24,40,.12)'
      }
    }
  },
  plugins: []
}
