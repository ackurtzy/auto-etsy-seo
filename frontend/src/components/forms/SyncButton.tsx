import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { syncShop } from '../../api/mutations'
import { overviewKeys, proposalKeys } from '../../api/queries'
import { formatRelative } from '../../utils/dates'
import { useApi } from '../../hooks/useApi'
import { primaryButtonClass, subtleTextClass } from '../../styles/shared'

export default function SyncButton() {
  const api = useApi()
  const queryClient = useQueryClient()
  const [lastSynced, setLastSynced] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => syncShop(api, { limit: 100, sync_images: true }),
    onSuccess: (response) => {
      setLastSynced(response.synced_at || new Date().toISOString())
      queryClient.invalidateQueries({ queryKey: overviewKeys.all })
      queryClient.invalidateQueries({ queryKey: proposalKeys.all })
      queryClient.invalidateQueries({ queryKey: ['experiments-board'], exact: false })
      queryClient.invalidateQueries({ queryKey: ['listings'], exact: false })
    },
  })

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className={primaryButtonClass} onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? 'Syncing…' : 'Sync with Etsy'}
      </button>
      {lastSynced && <span className={`${subtleTextClass} text-xs`}>Synced {formatRelative(lastSynced)}</span>}
    </div>
  )
}
