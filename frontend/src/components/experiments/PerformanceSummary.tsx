import type { ExperimentPerformance } from '../../api/types'
import { formatPercentFromDecimal } from '../../utils/format'
import { formatDate } from '../../utils/dates'
import { subtleTextClass } from '../../styles/shared'

type Props = {
  performance?: ExperimentPerformance
}

export default function PerformanceSummary({ performance }: Props) {
  if (!performance) return null
  const { baseline, latest } = performance

  return (
    <div className="mt-6 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
      <div className="rounded-xl bg-surface-muted p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-muted">Baseline Views</div>
        <div className="text-2xl font-bold">{baseline?.views ?? '—'}</div>
        <div className={subtleTextClass}>{formatDate(baseline?.date)}</div>
      </div>
      <div className="rounded-xl bg-surface-muted p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-muted">Latest Views</div>
        <div className="text-2xl font-bold">{latest?.views ?? '—'}</div>
        <div className={subtleTextClass}>{formatDate(latest?.date)}</div>
      </div>
      <div className="rounded-xl bg-surface-muted p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-muted">Normalized Delta</div>
        <div className="text-2xl font-bold">{formatPercentFromDecimal(latest?.normalized_delta ?? null, 1)}</div>
        <div className={subtleTextClass}>
          Confidence {latest?.confidence ? formatPercentFromDecimal(latest.confidence, 0) : '—'}
        </div>
      </div>
    </div>
  )
}
