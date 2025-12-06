import { useMutation, useQueryClient } from '@tanstack/react-query'
import ProposalAccordion from '../../../components/experiments/ProposalAccordion'
import ListingRow from '../../../components/listing/ListingRow'
import EmptyState from '../../../components/layout/EmptyState'
import type { ProposalRecord } from '../../../api/types'
import { useApi } from '../../../hooks/useApi'
import { overviewKeys, proposalKeys } from '../../../api/queries'
import { regenerateProposal, selectProposal } from '../../../api/mutations'
import { useSettingsContext } from '../../../app/providers/SettingsProvider'
import { chipClass, secondaryButtonClass, subtleTextClass } from '../../../styles/shared'
import { formatRelative } from '../../../utils/dates'

interface Props {
  proposals: ProposalRecord[]
  generatingCount: number
}

export default function ProposalsTab({ proposals, generatingCount }: Props) {
  const api = useApi()
  const queryClient = useQueryClient()
  const { experimentDefaults } = useSettingsContext()

  const selectMutation = useMutation<
    Awaited<ReturnType<typeof selectProposal>>,
    Error,
    { listingId: number; experimentId: string }
  >({
    mutationFn: ({ listingId, experimentId }) => selectProposal(api, listingId, experimentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments-board'], exact: false })
      queryClient.invalidateQueries({ queryKey: proposalKeys.all })
      queryClient.invalidateQueries({ queryKey: overviewKeys.all })
    },
  })

  const regenerateMutation = useMutation<
    Awaited<ReturnType<typeof regenerateProposal>>,
    Error,
    { listingId: number }
  >({
    mutationFn: ({ listingId }) => regenerateProposal(api, listingId, experimentDefaults),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments-board'], exact: false })
      queryClient.invalidateQueries({ queryKey: proposalKeys.all })
    },
  })

  if (!proposals.length) {
    return <EmptyState title="No proposals waiting" description="Generate new ideas from the Inactive tab." />
  }

  return (
    <div className="space-y-4">
      {generatingCount > 0 && (
        <div className={`${chipClass} bg-primary/10 text-primary`}>
          {generatingCount} listing{generatingCount === 1 ? '' : 's'} generating&hellip;
        </div>
      )}
      {proposals.map((proposal) => (
        <ListingRow
          key={proposal.listing_id}
          preview={proposal.preview}
          meta={
            <>
              <span>Generated {formatRelative(proposal.generated_at)}</span>
              {proposal.run_duration_days && <span>{proposal.run_duration_days}-day run</span>}
              {proposal.model_used && <span>Model {proposal.model_used}</span>}
              <span>{proposal.options.length} options</span>
            </>
          }
          actions={
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => regenerateMutation.mutate({ listingId: proposal.listing_id })}
              disabled={regenerateMutation.isPending && regenerateMutation.variables?.listingId === proposal.listing_id}
            >
              {regenerateMutation.isPending && regenerateMutation.variables?.listingId === proposal.listing_id
                ? 'Regenerating…'
                : 'Regenerate'}
            </button>
          }
        >
          <p className={subtleTextClass}>Select an option to immediately launch the experiment.</p>
          <ProposalAccordion
            proposal={proposal}
            onSelect={(experimentId) =>
              selectMutation.mutate({ listingId: proposal.listing_id, experimentId })
            }
            isProcessing={
              selectMutation.isPending && selectMutation.variables?.listingId === proposal.listing_id
            }
            activeExperimentId={selectMutation.variables?.experimentId || null}
          />
        </ListingRow>
      ))}
    </div>
  )
}
