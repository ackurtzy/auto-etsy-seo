import type { BoardExperimentEntry } from '../../api/types'
import { formatDate, formatRelative } from '../../utils/dates'
import { labelClass } from '../../styles/shared'

type Props = {
  record: BoardExperimentEntry
}

export default function ExperimentDetails({ record }: Props) {
  const infoBlocks = [
    { label: 'Start', value: formatDate(record.start_date) },
    { label: 'Planned End', value: formatDate(record.planned_end_date) },
    { label: 'Duration', value: record.run_duration_days ? `${record.run_duration_days} days` : '—' },
    { label: 'Model', value: record.model_used || '—' },
  ]

  if (record.planned_end_date) {
    infoBlocks.push({ label: 'Status checkpoint', value: formatRelative(record.planned_end_date) })
  }

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {infoBlocks.map((block) => (
        <div key={block.label} className="rounded-xl bg-surface-muted px-4 py-3">
          <div className={labelClass}>{block.label}</div>
          <div className="font-semibold text-brand-text">{block.value}</div>
        </div>
      ))}
    </div>
  )
}
