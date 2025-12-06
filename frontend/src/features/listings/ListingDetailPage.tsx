import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchListingDetail, listingsKeys } from '../../api/queries'
import { useApi } from '../../hooks/useApi'
import EmptyState from '../../components/layout/EmptyState'
import type { ProposalRecord, ExperimentRecord } from '../../api/types'
import PerformanceSummary from '../../components/experiments/PerformanceSummary'
import { formatDate } from '../../utils/dates'
import { formatPercentFromDecimal } from '../../utils/format'
import { useSettingsContext } from '../../app/providers/SettingsProvider'
import { chipClass, eyebrowClass, pageTitleClass, panelClass, subtleTextClass } from '../../styles/shared'

const resolveImages = (proposalImages: any, listingId: number, baseUrl: string): string[] => {
  const urls: string[] = []
  const fromFiles = proposalImages?.files || []
  fromFiles.forEach((file: { path?: string }) => {
    if (file?.path) {
      const filename = file.path.split('/').pop()
      if (filename) {
        urls.push(`${baseUrl}/images/${listingId}/${filename}`)
      }
    }
  })
  const fromResults = proposalImages?.results || []
  fromResults.forEach((result: { url_fullxfull?: string; url_570xN?: string }) => {
    if (result?.url_fullxfull) urls.push(result.url_fullxfull)
    else if (result?.url_570xN) urls.push(result.url_570xN)
  })
  return urls
}

const experimentsFromObject = (input: Record<string, ExperimentRecord>) =>
  Object.values(input || {}).map((record) => record)

const Sparkline = ({ data }: { data: Array<{ date: string; views?: number }> }) => {
  if (!data.length) return <div className={subtleTextClass}>No performance history</div>
  const values = data.map((entry) => entry.views || 0)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = Math.max(max - min, 1)
  const points = data
    .map((entry, index) => {
      const x = (index / (data.length - 1 || 1)) * 100
      const y = 100 - (((entry.views || 0) - min) / range) * 100
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-32 w-full text-primary" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function ListingDetailPage() {
  const { listingId } = useParams()
  const api = useApi()
  const { baseUrl } = useSettingsContext()
  const numericId = Number(listingId)

  const detailQuery = useQuery({
    queryKey: listingsKeys.detail(numericId),
    queryFn: () => fetchListingDetail(api, numericId),
    enabled: Number.isFinite(numericId),
  })

  if (!Number.isFinite(numericId)) {
    return <EmptyState title="Invalid listing" description="Listing id missing from URL." />
  }

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-6">
        <p className={subtleTextClass}>Loading listing…</p>
      </div>
    )
  }

  if (detailQuery.isError || !detailQuery.data) {
    return <EmptyState title="Listing not found" description={(detailQuery.error as Error)?.message} />
  }

  const detail = detailQuery.data
  const proposal = detail.proposal as ProposalRecord | undefined
  const untested = experimentsFromObject(detail.untested_experiments)
  const testing = detail.testing_experiment as ExperimentRecord | null
  const tested = detail.tested_experiments || []
  const imageUrls = resolveImages(detail.images, numericId, baseUrl)
  const listingInfo = detail.listing as { title?: string; state?: string } | undefined

  const statBlocks = [
    { label: 'Active tests', value: testing ? 1 : 0, description: testing ? 'Running now' : 'None' },
    { label: 'Proposal options', value: proposal?.options.length || 0, description: 'Ready to launch' },
    { label: 'Backlog ideas', value: untested.length, description: 'Queued for testing' },
    { label: 'Completed runs', value: tested.length, description: 'With historical outcomes' },
  ]

  return (
    <div className="space-y-8">
      <Link to="/listings" className="text-sm font-semibold text-primary hover:underline">
        ← Back to listings
      </Link>
      <div className="space-y-4">
        <div>
          <p className={eyebrowClass}>Listing detail</p>
          <h1 className={pageTitleClass}>{listingInfo?.title || 'Listing'}</h1>
          <p className={subtleTextClass}>Listing #{numericId}</p>
          {listingInfo?.state && <span className={`${chipClass} mt-3 inline-flex`}>{listingInfo.state}</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {statBlocks.map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-border/70 bg-surface p-4 text-center">
              <div className="text-3xl font-bold text-brand-text">{stat.value}</div>
              <div className={eyebrowClass}>{stat.label}</div>
              <div className="text-xs text-brand-muted">{stat.description}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className={panelClass}>
          <h2 className="font-serif text-xl">Media</h2>
          <div className="mt-4 flex gap-4 overflow-x-auto rounded-2xl bg-surface-muted/50 p-3">
            {imageUrls.length ? (
              imageUrls.map((src) => (
                <img
                  key={src}
                  src={src}
                  alt={listingInfo?.title}
                  className="h-48 w-48 flex-shrink-0 snap-start rounded-2xl border border-border object-cover"
                />
              ))
            ) : (
              <p className={subtleTextClass}>No images synced for this listing.</p>
            )}
          </div>
        </div>
        <div className={panelClass}>
          <h2 className="font-serif text-xl">Performance trend</h2>
          <div className="mt-4 text-sm text-brand-muted">{detail.performance.length || 0} data points tracked.</div>
          <div className="mt-4">
            <Sparkline data={detail.performance} />
          </div>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className={panelClass}>
          <h3 className="font-serif text-lg">Active testing</h3>
          {testing ? (
            <div className="space-y-3">
              <div className={chipClass}>{testing.state}</div>
              <PerformanceSummary performance={testing.performance} />
              {testing.notes && <p className="text-sm text-brand-text">{testing.notes}</p>}
            </div>
          ) : (
            <p className={subtleTextClass}>No experiment is live right now.</p>
          )}
        </div>
        <div className={panelClass}>
          <h3 className="font-serif text-lg">Proposal options</h3>
          {proposal ? (
            <div className="space-y-3">
              <p className={subtleTextClass}>Generated {formatDate(proposal.generated_at)}</p>
              {proposal.options.map((option, index) => (
                <div key={option.experiment_id} className="rounded-2xl border border-border/60 bg-surface-muted p-3">
                  <div className="flex items-center gap-2">
                    <span className={chipClass}>Option {option.option_index ?? index + 1}</span>
                    <span className="font-semibold text-brand-text">{option.change_summary || option.hypothesis}</span>
                  </div>
                  {option.notes && <p className={subtleTextClass}>{option.notes}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className={subtleTextClass}>No proposals yet. Generate them from the Experiments page.</p>
          )}
        </div>
      </div>
      <div className={panelClass}>
        <h3 className="font-serif text-lg">Untested backlog</h3>
        {untested.length ? (
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-brand-text">
            {untested.map((record) => (
              <li key={record.experiment_id}>
                <strong>{record.state}</strong> · {record.notes || 'Idea ready to accept'}
              </li>
            ))}
          </ul>
        ) : (
          <p className={subtleTextClass}>Select new proposals to populate this queue.</p>
        )}
      </div>
      <div className={panelClass}>
        <h3 className="font-serif text-lg">Tested history</h3>
        {tested.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-brand-muted">
                <tr>
                  <th className="py-2">Experiment</th>
                  <th className="py-2">End Date</th>
                  <th className="py-2">Outcome</th>
                  <th className="py-2">Impact</th>
                </tr>
              </thead>
              <tbody>
                {tested.map((record) => (
                  <tr key={record.experiment_id} className="border-t border-border/70">
                    <td className="py-2 capitalize">{record.state}</td>
                    <td className="py-2">{formatDate(record.end_date)}</td>
                    <td className="py-2">{record.notes || '—'}</td>
                    <td className="py-2">{formatPercentFromDecimal(record.performance?.latest?.normalized_delta ?? null, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={subtleTextClass}>No completed experiments yet.</p>
        )}
      </div>
    </div>
  )
}
