import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { BoardExperimentEntry } from '../../api/types'
import { keepExperiment, revertExperiment, extendExperiment } from '../../api/mutations'
import { overviewKeys, proposalKeys } from '../../api/queries'
import { formatDate } from '../../utils/dates'
import { useApi } from '../../hooks/useApi'
import PerformanceSummary from './PerformanceSummary'
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from '../../styles/shared'

interface Props {
  record: BoardExperimentEntry
}

export default function FinishedDecisionAccordion({ record }: Props) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [extendDays, setExtendDays] = useState(3)

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['experiments-board'], exact: false })
    queryClient.invalidateQueries({ queryKey: overviewKeys.all })
    queryClient.invalidateQueries({ queryKey: proposalKeys.all })
    queryClient.invalidateQueries({ queryKey: ['listings'], exact: false })
  }

  const keepMutation = useMutation({
    mutationFn: () => keepExperiment(api, record.listing_id, record.experiment_id),
    onSuccess: invalidateAll,
  })

  const revertMutation = useMutation({
    mutationFn: () => revertExperiment(api, record.listing_id, record.experiment_id),
    onSuccess: invalidateAll,
  })

  const extendMutation = useMutation({
    mutationFn: () => extendExperiment(api, record.listing_id, record.experiment_id, extendDays || 3),
    onSuccess: invalidateAll,
  })

  return (
    <div className="rounded-2xl border border-border/70 bg-surface-muted p-4">
      <div className={`${labelClass} mb-1`}>Ready for a decision</div>
      <p className="text-sm text-brand-muted">Ended on {formatDate(record.planned_end_date)}</p>
      <PerformanceSummary performance={record.performance} />
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <button
          type="button"
          className={primaryButtonClass}
          onClick={() => keepMutation.mutate()}
          disabled={keepMutation.isPending}
        >
          {keepMutation.isPending ? 'Keeping…' : 'Keep'}
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() => revertMutation.mutate()}
          disabled={revertMutation.isPending}
        >
          {revertMutation.isPending ? 'Reverting…' : 'Revert'}
        </button>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Extend Days</span>
          <input
            type="number"
            className={inputClass}
            min={1}
            value={extendDays}
            onChange={(event) => setExtendDays(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() => extendMutation.mutate()}
          disabled={extendMutation.isPending}
        >
          {extendMutation.isPending ? 'Extending…' : 'Extend'}
        </button>
      </div>
    </div>
  )
}
