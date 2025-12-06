import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { saveExperimentSettings } from '../../api/mutations'
import { fetchExperimentSettings, settingsKeys } from '../../api/queries'
import { useApi } from '../../hooks/useApi'
import { useSettingsContext } from '../../app/providers/SettingsProvider'
import { inputClass, labelClass, primaryButtonClass, subtleTextClass } from '../../styles/shared'

export default function SettingsForm() {
  const api = useApi()
  const { baseUrl, setBaseUrl, experimentDefaults, updateExperimentDefaults } = useSettingsContext()
  const [localBaseUrl, setLocalBaseUrl] = useState(baseUrl)
  const [runDuration, setRunDuration] = useState<number | ''>(experimentDefaults.runDurationDays || '')
  const [model, setModel] = useState(experimentDefaults.generationModel || '')
  const [tolerance, setTolerance] = useState<number | ''>(experimentDefaults.tolerance ?? '')
  const [includePrior, setIncludePrior] = useState<boolean>(experimentDefaults.includePriorExperiments ?? true)

  useEffect(() => {
    setLocalBaseUrl(baseUrl)
  }, [baseUrl])

  const settingsQuery = useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => fetchExperimentSettings(api),
  })

  useEffect(() => {
    const data = settingsQuery.data
    if (!data) return
    updateExperimentDefaults({
      runDurationDays: data.run_duration_days,
      generationModel: data.generation_model,
      tolerance: data.tolerance,
    })
    if (data.run_duration_days !== undefined) setRunDuration(data.run_duration_days)
    if (data.generation_model !== undefined) setModel(data.generation_model)
    if (data.tolerance !== undefined) setTolerance(data.tolerance)
  }, [settingsQuery.data, updateExperimentDefaults])

  const mutation = useMutation({
    mutationFn: () =>
      saveExperimentSettings(api, {
        runDurationDays: runDuration === '' ? undefined : Number(runDuration),
        generationModel: model,
        tolerance: tolerance === '' ? undefined : Number(tolerance),
      }),
    onSuccess: (data) => {
      updateExperimentDefaults({
        runDurationDays: data.run_duration_days,
        generationModel: data.generation_model,
        tolerance: data.tolerance,
        includePriorExperiments: includePrior,
      })
    },
  })

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setBaseUrl(localBaseUrl)
    updateExperimentDefaults({ includePriorExperiments: includePrior })
    mutation.mutate()
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <label className="space-y-1">
        <span className={labelClass}>API Base URL</span>
        <input className={inputClass} value={localBaseUrl} onChange={(event) => setLocalBaseUrl(event.target.value)} />
      </label>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1">
          <span className={labelClass}>Run Duration (days)</span>
          <input
            className={inputClass}
            type="number"
            min={1}
            value={runDuration}
            onChange={(event) => {
              const value = event.target.value
              setRunDuration(value === '' ? '' : Number(value))
            }}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Generation Model</span>
          <input className={inputClass} value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Tolerance</span>
          <input
            className={inputClass}
            type="number"
            step="0.01"
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
      <div className="flex justify-end">
        <button type="submit" className={primaryButtonClass} disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
      {settingsQuery.isLoading && <div className={subtleTextClass}>Loading settings…</div>}
    </form>
  )
}
