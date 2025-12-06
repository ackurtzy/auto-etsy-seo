import type { ReactNode } from 'react'
import type { ListingPreview } from '../../api/types'
import { formatPercentFromDecimal } from '../../utils/format'
import { chipClass, eyebrowClass, panelClass } from '../../styles/shared'

type Highlight = {
  preview?: ListingPreview
  normalized_delta?: number | null
}

type StatCardProps = {
  title: string
  value: ReactNode
  description?: ReactNode
  best?: Highlight | null
  worst?: Highlight | null
  onClick?: () => void
}

export default function StatCard({ title, value, description, best, worst, onClick }: StatCardProps) {
  const highlight = (label: string, record?: Highlight | null) => {
    if (!record?.preview) return null
    return (
      <div className="flex items-center gap-2 text-sm text-brand-muted">
        <span className={eyebrowClass}>{label}</span>
        <span className="line-clamp-1 flex-1 font-semibold text-brand-text">
          {record.preview.title_30 || record.preview.title}
        </span>
        {typeof record.normalized_delta === 'number' && (
          <span className={`${chipClass} bg-primary/10 text-primary`}>
            {formatPercentFromDecimal(record.normalized_delta, 1)}
          </span>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${panelClass} flex h-full flex-col gap-3 text-left transition hover:-translate-y-0.5 hover:shadow-card`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={eyebrowClass}>Pipeline metric</p>
          <h3 className="font-serif text-2xl font-semibold leading-tight text-brand-text">{title}</h3>
        </div>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted text-brand-muted">
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
            <path d="M5 12h14m0 0-5-5m5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      <div className="text-4xl font-bold text-brand-text">{value}</div>
      {description && <p className="text-sm text-brand-muted">{description}</p>}
      {(best || worst) && <div className="mt-2 space-y-1 border-t border-border/70 pt-2">{highlight('Best', best)}{highlight('Worst', worst)}</div>}
    </button>
  )
}
