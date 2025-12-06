import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { overviewKeys, proposalKeys, summaryKeys, fetchExperimentSummary } from '../../api/queries'
import { keepExperiment, extendExperiment, revertExperiment } from '../../api/mutations'
import { formatDate } from '../../utils/dates'
import PerformanceSummary from './PerformanceSummary'
import { useApi } from '../../hooks/useApi'
import { useSettingsContext } from '../../app/providers/SettingsProvider'
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass, subtleTextClass } from '../../styles/shared'

interface Props {
  listingId: number
  experimentId: string
  open: boolean
  onClose: () => void
}

export default function EndExperimentDialog({ listingId, experimentId, open, onClose }: Props) {
  const api = useApi()
  const queryClient = useQueryClient()
  const { experimentDefaults } = useSettingsContext()
  const [extendDays, setExtendDays] = useState(experimentDefaults.runDurationDays || 3)

  useEffect(() => {
    if (experimentDefaults.runDurationDays) {
      setExtendDays(experimentDefaults.runDurationDays)
    }
  }, [experimentDefaults.runDurationDays])

  const summaryQuery = useQuery({
    queryKey: summaryKeys.detail(listingId, experimentId),
    queryFn: () => fetchExperimentSummary(api, listingId, experimentId),
    enabled: open,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['experiments-board'], exact: false })
    queryClient.invalidateQueries({ queryKey: overviewKeys.all })
    queryClient.invalidateQueries({ queryKey: proposalKeys.all })
    queryClient.invalidateQueries({ queryKey: ['listings'], exact: false })
  }

  const keepMutation = useMutation({
    mutationFn: () => keepExperiment(api, listingId, experimentId),
    onSuccess: () => {
      invalidateAll()
      onClose()
    },
  })

  const revertMutation = useMutation({
    mutationFn: () => revertExperiment(api, listingId, experimentId),
    onSuccess: () => {
      invalidateAll()
      onClose()
    },
  })

  const extendMutation = useMutation({
    mutationFn: () => extendExperiment(api, listingId, experimentId, extendDays || 3),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: summaryKeys.detail(listingId, experimentId) })
      invalidateAll()
    },
  })

  if (!open) return null

  const { data, isLoading, isError, error } = summaryQuery

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-surface p-8 shadow-card-strong">
        {isLoading && <div>Loading experiment summary…</div>}
        {isError && <div className={subtleTextClass}>{(error as Error).message}</div>}
        {data && (
          <>
            <h2 className="font-serif text-2xl">End Experiment</h2>
            <div className={subtleTextClass}>
              {data.preview.title} · Started {formatDate(data.record.start_date)}
            </div>
            <PerformanceSummary performance={data.record.performance} />
            <div className="my-4 border-t border-border" />
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className={primaryButtonClass}
                onClick={() => keepMutation.mutate()}
                disabled={keepMutation.isPending || revertMutation.isPending}
              >
                {keepMutation.isPending ? 'Keeping…' : 'Keep Change'}
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => revertMutation.mutate()}
                disabled={keepMutation.isPending || revertMutation.isPending}
              >
                {revertMutation.isPending ? 'Reverting…' : 'Revert Change'}
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="space-y-1">
                <span className={labelClass}>Extend by days</span>
                <input
                  type="number"
                  min={1}
                  className={inputClass}
                  value={extendDays}
                  onChange={(event) => setExtendDays(Number(event.target.value))}
                />
              </label>
              <div className="flex items-end">
                <button type="button" className={secondaryButtonClass} onClick={() => extendMutation.mutate()} disabled={extendMutation.isPending}>
                  {extendMutation.isPending ? 'Extending…' : 'Extend Run'}
                </button>
              </div>
            </div>
          </>
        )}
        <div className="mt-6 flex justify-end">
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
