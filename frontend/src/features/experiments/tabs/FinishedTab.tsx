import FinishedDecisionAccordion from '../../../components/experiments/FinishedDecisionAccordion'
import ListingRow from '../../../components/listing/ListingRow'
import EmptyState from '../../../components/layout/EmptyState'
import type { BoardExperimentEntry } from '../../../api/types'
import { formatDate } from '../../../utils/dates'

interface Props {
  entries: BoardExperimentEntry[]
}

export default function FinishedTab({ entries }: Props) {
  if (!entries.length) {
    return <EmptyState title="No finished experiments" description="Active experiments will land here when the window ends." />
  }

  return (
    <div className="space-y-4">
      {entries.map((entry) => (
        <ListingRow
          key={entry.experiment_id}
          preview={entry.preview}
          meta={
            <>
              {entry.end_date && <span>Ended {formatDate(entry.end_date)}</span>}
              {entry.run_duration_days && <span>{entry.run_duration_days}-day run</span>}
            </>
          }
        >
          <FinishedDecisionAccordion record={entry} />
        </ListingRow>
      ))}
    </div>
  )
}
