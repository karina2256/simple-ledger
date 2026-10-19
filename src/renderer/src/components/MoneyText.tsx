import { useEffect, useRef, useState } from 'react'
import { formatMoney } from '@shared/money'
import type { RecordType } from '@shared/types'
import { useAppStore } from '../stores/app.store'
import { useCountUp } from '../motion'

/**
 * 金额显示：默认人民币；设置里开启美元后同时显示换算结果。
 *
 * countUp：给页面级汇总用（收入 / 支出 / 结余 / 账户余额）。
 *   数值变化时用弹簧曲线滚到新数字（会轻微冲过目标再回落），并给一个缩放冲击波；
 *   列表里成百上千行不要开——同时滚动几百个数字是噪音，不是信息。
 */
export function MoneyText({
  cents,
  type,
  signed = false,
  className = '',
  strong = false,
  countUp = false
}: {
  cents: number
  type?: RecordType
  signed?: boolean
  className?: string
  strong?: boolean
  countUp?: boolean
}): JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const shown = useCountUp(cents, { enabled: countUp, spring: true })

  // 目标值一变就换一次 key，让「冲击波」动画重放（不是每帧都放）
  const [popKey, setPopKey] = useState(0)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setPopKey((key) => key + 1)
  }, [cents])

  const { primary, secondary } = formatMoney(shown, {
    currency: settings.currency,
    showUsd: settings.showUsd,
    usdRate: settings.usdRate,
    signed,
    type
  })
  // 支出用语义红，收入用语义绿，转账（无方向）保持中性；整行背景不受影响
  const tone =
    type === 'income' ? 'text-income' : type === 'expense' ? 'text-expense' : 'text-muted'
  return (
    <span className={`${tone} ${strong ? 'font-medium' : ''} tabular-nums ${className}`}>
      <span key={popKey} className={countUp ? 'cinema-amount-pop' : undefined}>
        {primary}
      </span>
      {secondary ? <span className="ml-1 text-xs text-muted">{secondary}</span> : null}
    </span>
  )
}
