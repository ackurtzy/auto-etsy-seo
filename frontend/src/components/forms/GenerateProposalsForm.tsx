import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { generateProposals } from '../../api/mutations'
import { overviewKeys, proposalKeys } from '../../api/queries'
import { useApi } from '../../hooks/useApi'
import { useSettingsContext } from '../../app/providers/SettingsProvider'
import { inputClass, labelClass, primaryButtonClass, subtleTextClass } from '../../styles/shared'

type Props = {
  selectedIds: number[]
  onComplete?: () => void
  onGenerating?: (count: number) => void
}

export default function GenerateProposalsForm({ selectedIds, onComplete, onGenerating }: Props) {
  const api = useApi()
  const queryClient = useQueryClient()
  const { experimentDefaults, updateExperimentDefaults } = useSettingsContext()

  const [duration, setDuration] = useState<number | ''>(experimentDefaults.runDurationDays || '')
  const [model, setModel] = useState(experimentDefaults.generationModel || '')
  const [tolerance, setTolerance] = useState<number | ''>(experimentDefaults.tolerance ?? '')
  const [includePrior, setIncludePrior] = useState<boolean>(experimentDefaults.includePriorExperiments ?? true)

  useEffect(() => {
    setDuration(experimentDefaults.runDurationDays || '')
    setModel(experimentDefaults.generationModel || '')
    setTolerance(experimentDefaults.tolerance ?? '')
    setIncludePrior(experimentDefaults.includePriorExperiments ?? true)
  }, [experimentDefaults])

  const mutation = useMutation({
    mutationFn: () =>
      generateProposals(api, selectedIds, {
        runDurationDays: duration === '' ? undefined : Number(duration),
        generationModel: model,
        tolerance: tolerance === '' ? undefined : Number(tolerance),
        includePriorExperiments: includePrior,
      }),
    onMutate: () => {
      onGenerating?.(selectedIds.length)
    },
    onSettled: () => {
      onGenerating?.(0)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments-board'], exact: false })
      queryClient.invalidateQueries({ queryKey: overviewKeys.all })
      queryClient.invalidateQueries({ queryKey: proposalKeys.all })
      updateExperimentDefaults({
        runDurationDays: duration === '' ? undefined : Number(duration),
        generationModel: model,
        tolerance: tolerance === '' ? undefined : Number(tolerance),
        includePriorExperiments: includePrior,
      })
      onComplete?.()
    },
  })

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedIds.length) return
    mutation.mutate()
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <div className={labelClass}>{selectedIds.length} listings selected</div>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1">
          <span className={labelClass}>Duration (days)</span>
          <input
            type="number"
            min={1}
            className={inputClass}
            value={duration}
            onChange={(event) => {
              const value = event.target.value
              setDuration(value === '' ? '' : Number(value))
            }}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Model</span>
          <input className={inputClass} value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Tolerance</span>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={tolerance}
            onChange={(event) => {
              const value = event.target.value
              setTolerance(value === '' ? '' : Number(value))
            }}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-brand-text">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          checked={includePrior}
          onChange={(event) => setIncludePrior(event.target.checked)}
        />
        Include prior experiments when prompting
      </label>
      <div className="flex items-center justify-between">
        <span className={subtleTextClass}>
          {mutation.isPending ? 'Generating proposals…' : 'Ready to generate selected listings'}
        </span>
        <button type="submit" className={primaryButtonClass} disabled={!selectedIds.length || mutation.isPending}>
          {mutation.isPending ? 'Generating…' : 'Generate Proposals'}
        </button>
      </div>
    </form>
  )
}
