import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import EmptyState from '../../components/layout/EmptyState'
import { deactivateInsights, deleteInsight } from '../../api/mutations'
import { fetchInsights, insightsKeys } from '../../api/queries'
import { useApi } from '../../hooks/useApi'
import { labelClass, pageTitleClass, panelClass, primaryButtonClass, secondaryButtonClass, subtleTextClass } from '../../styles/shared'

export default function InsightsPage() {
  const api = useApi()
  const queryClient = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const insightsQuery = useQuery({
    queryKey: insightsKeys.all,
    queryFn: () => fetchInsights(api),
  })

  const deleteMutation = useMutation({
    mutationFn: (insightId: string) => deleteInsight(api, insightId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: insightsKeys.all }),
  })

  const bulkMutation = useMutation({
    mutationFn: (ids: string[]) => deactivateInsights(api, ids),
    onSuccess: () => {
      setSelectedIds([])
      queryClient.invalidateQueries({ queryKey: insightsKeys.all })
    },
  })

  const insights = insightsQuery.data?.results || []

  useEffect(() => {
    setSelectedIds([])
  }, [insightsQuery.data])

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]))
  }

  if (insightsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <p className={subtleTextClass}>Loading insights…</p>
      </div>
    )
  }

  if (insightsQuery.isError) {
    return <EmptyState title="Unable to load insights" description={(insightsQuery.error as Error).message} />
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-muted">Insights</p>
        <h1 className={pageTitleClass}>Active Insights</h1>
        <p className={subtleTextClass}>Deactivate stale learnings or hop to Reports to activate new insights.</p>
      </div>
      <div className={`${panelClass} flex flex-wrap items-center justify-between gap-3`}>
        <div>
          <div className="text-sm font-semibold text-brand-text">{insights.length} active</div>
          <div className={subtleTextClass}>Select any insight to remove it from prompts.</div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setSelectedIds(insights.map((insight) => insight.insight_id))}
            disabled={!insights.length}
          >
            Select all
          </button>
          <Link className={primaryButtonClass} to="/reports">
            Go to Reports
          </Link>
        </div>
      </div>
      {!insights.length && <EmptyState title="No active insights" description="Activate insights from a report to reuse them in prompts." />}
      <div className="grid gap-4 md:grid-cols-2">
        {insights.map((insight) => (
          <div key={insight.insight_id} className={`${panelClass} space-y-3`}>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border border-border/70 text-primary focus:ring-primary"
                checked={selectedIds.includes(insight.insight_id)}
                onChange={() => toggleSelection(insight.insight_id)}
              />
              <div>
                <div className={labelClass}>{insight.insight_id}</div>
                <p className="text-lg font-semibold text-brand-text">{insight.text}</p>
              </div>
            </div>
            <p className={subtleTextClass}>{insight.reasoning}</p>
            <div className="mt-3 flex gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => deleteMutation.mutate(insight.insight_id)}>
                Deactivate
              </button>
            </div>
          </div>
        ))}
      </div>
      {selectedIds.length > 0 && (
        <div className={`${panelClass} flex flex-wrap items-center justify-between gap-3`}>
          <div>
            <div className="font-semibold text-brand-text">{selectedIds.length} insight(s) selected</div>
            <div className={subtleTextClass}>Bulk actions apply instantly across the app.</div>
          </div>
          <div className="flex gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => setSelectedIds([])}>
              Clear
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => bulkMutation.mutate(selectedIds)}
              disabled={bulkMutation.isPending}
            >
              {bulkMutation.isPending ? 'Removing…' : 'Deactivate selected'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
