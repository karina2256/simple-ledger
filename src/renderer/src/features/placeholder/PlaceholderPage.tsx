import { Card } from '../../components/ui'

export function PlaceholderPage({
  title,
  round,
  note
}: {
  title: string
  round: string
  note: string
}): JSX.Element {
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-medium mb-4">{title}</h1>
      <Card>
        <p className="text-sm text-main mb-1">{note}</p>
        <p className="text-xs text-muted">这部分安排在{round}实现。</p>
      </Card>
    </div>
  )
}
