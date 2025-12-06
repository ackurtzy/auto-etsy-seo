import ListingRow from '../../../components/listing/ListingRow'
import EmptyState from '../../../components/layout/EmptyState'
import type { BoardExperimentEntry } from '../../../api/types'
import { formatDate } from '../../../utils/dates'
import { formatPercentFromDecimal } from '../../../utils/format'
import { chipClass, subtleTextClass } from '../../../styles/shared'

interface Props {
  entries: BoardExperimentEntry[]
}

export default function CompletedTab({ entries }: Props) {
  if (!entries.length) {
    return <EmptyState title="No completed experiments" description="Decisions will show here for historical context." />
  }

  return (
    <div className="space-y-4">
      {entries.map((entry) => (
        <ListingRow
          key={`${entry.listing_id}-${entry.experiment_id}`}
          preview={entry.preview}
          meta={<span>Ended {formatDate(entry.end_date)}</span>}
        >
          <div className={chipClass}>{entry.state?.toUpperCase()}</div>
          <p className={subtleTextClass}>
            Normalized delta {formatPercentFromDecimal(entry.performance?.latest?.normalized_delta ?? null, 1)} ·
            Confidence {formatPercentFromDecimal(entry.performance?.latest?.confidence ?? null, 0)}
          </p>
        </ListingRow>
      ))}
    </div>
  )
}
