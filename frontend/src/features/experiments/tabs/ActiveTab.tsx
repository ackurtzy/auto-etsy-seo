import { useState } from 'react'
import ListingRow from '../../../components/listing/ListingRow'
import ExperimentDetails from '../../../components/experiments/ExperimentDetails'
import PerformanceSummary from '../../../components/experiments/PerformanceSummary'
import EmptyState from '../../../components/layout/EmptyState'
import EndExperimentDialog from '../../../components/experiments/EndExperimentDialog'
import type { BoardExperimentEntry } from '../../../api/types'
import { formatDate } from '../../../utils/dates'
import { chipClass, secondaryButtonClass, subtleTextClass } from '../../../styles/shared'

interface Props {
  entries: BoardExperimentEntry[]
}

export default function ActiveTab({ entries }: Props) {
  const [dialog, setDialog] = useState<{ listingId: number; experimentId: string } | null>(null)

  if (!entries.length) {
    return <EmptyState title="No active experiments" description="Launch proposals to start testing." />
  }

  return (
    <div className="space-y-4">
      {entries.map((entry) => (
        <ListingRow
          key={entry.experiment_id}
          preview={entry.preview}
          meta={
            <>
              {entry.planned_end_date && <span>Ending {formatDate(entry.planned_end_date)}</span>}
              {entry.run_duration_days && <span>{entry.run_duration_days}-day run</span>}
              {entry.model_used && <span>Model {entry.model_used}</span>}
            </>
          }
          actions={
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => setDialog({ listingId: entry.listing_id, experimentId: entry.experiment_id })}
            >
              End early
            </button>
          }
        >
          <div className={`${chipClass} w-fit`}>{entry.state || 'Active'}</div>
          <p className={subtleTextClass}>We will keep tracking this until the planned end date.</p>
          <ExperimentDetails record={entry} />
          <PerformanceSummary performance={entry.performance} />
        </ListingRow>
      ))}
      {dialog && (
        <EndExperimentDialog
          listingId={dialog.listingId}
          experimentId={dialog.experimentId}
          open={Boolean(dialog)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
