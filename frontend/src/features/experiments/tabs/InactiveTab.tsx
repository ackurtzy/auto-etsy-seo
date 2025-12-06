import ListingCheckboxList from '../../../components/listing/ListingCheckboxList'
import EmptyState from '../../../components/layout/EmptyState'
import GenerateProposalsForm from '../../../components/forms/GenerateProposalsForm'
import type { ListingPreview } from '../../../api/types'
import { panelClass, secondaryButtonClass, sectionTitleClass, subtleTextClass } from '../../../styles/shared'

interface Props {
  listings: ListingPreview[]
  selectedIds: number[]
  toggle: (id: number) => void
  clear: () => void
  onGenerated: () => void
  onGenerating: (count: number) => void
}

export default function InactiveTab({ listings, selectedIds, toggle, clear, onGenerated, onGenerating }: Props) {
  if (!listings.length) {
    return <EmptyState title="Every listing is covered" description="All synced listings already have proposals, backlog ideas, or active experiments." />
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className={panelClass}>
        <div className={`${sectionTitleClass} mb-2 text-xl`}>Select listings</div>
        <p className={subtleTextClass}>Pick synced listings that don&apos;t yet have proposals or active tests.</p>
        <ListingCheckboxList listings={listings} isSelected={(id) => selectedIds.includes(id)} onToggle={toggle} />
        {selectedIds.length > 0 && (
          <button type="button" className={`${secondaryButtonClass} mt-4`} onClick={clear}>
            Clear selection
          </button>
        )}
      </div>
      <div className={panelClass}>
        <div className={`${sectionTitleClass} mb-2 text-xl`}>Generate proposals</div>
        <p className={subtleTextClass}>Customize the prompt inputs that will be used for every selected listing.</p>
        <GenerateProposalsForm selectedIds={selectedIds} onComplete={onGenerated} onGenerating={onGenerating} />
      </div>
    </div>
  )
}
