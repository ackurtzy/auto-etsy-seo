import type { ListingPreview } from '../../api/types'
import ListingPreviewCard from './ListingPreview'

type Props = {
  listings: ListingPreview[]
  isSelected: (id: number) => boolean
  onToggle: (id: number) => void
}

export default function ListingCheckboxList({ listings, isSelected, onToggle }: Props) {
  if (!listings.length) {
    return <div className="text-sm text-brand-muted">All synced listings already have experiments in motion.</div>
  }

  return (
    <div className="space-y-3">
      {listings.map((preview) => (
        <label
          key={preview.listing_id}
          className="flex gap-3 rounded-[22px] border border-white/70 bg-white/90 p-3 shadow-sm transition hover:border-primary"
        >
          <input
            type="checkbox"
            className="mt-2 h-4 w-4 rounded border border-border/70 text-primary focus:ring-primary"
            checked={isSelected(preview.listing_id)}
            onChange={() => onToggle(preview.listing_id)}
          />
          <ListingPreviewCard preview={preview} />
        </label>
      ))}
    </div>
  )
}
