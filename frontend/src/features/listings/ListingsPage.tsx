import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import ListingRow from '../../components/listing/ListingRow'
import SearchBar from '../../components/layout/SearchBar'
import Sorter from '../../components/layout/Sorter'
import EmptyState from '../../components/layout/EmptyState'
import { fetchListings, listingsKeys } from '../../api/queries'
import type { ListingSummary } from '../../api/types'
import { useApi } from '../../hooks/useApi'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { formatPercentFromDecimal } from '../../utils/format'
import { formatDate } from '../../utils/dates'
import { chipClass, pageTitleClass, panelClass, secondaryButtonClass, subtleTextClass } from '../../styles/shared'

const SORT_OPTIONS = [
  { label: 'Title A-Z', value: 'title' },
  { label: 'Most experiments', value: 'experiments' },
  { label: 'Lifetime uplift', value: 'uplift' },
]

export default function ListingsPage() {
  const api = useApi()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('title')
  const debouncedSearch = useDebouncedValue(search)

  const listingsQuery = useQuery({
    queryKey: listingsKeys.list(debouncedSearch, null),
    queryFn: () => fetchListings(api, debouncedSearch, null),
  })

  const sortedListings = useMemo(() => {
    const results = listingsQuery.data?.results || []
    switch (sort) {
      case 'experiments':
        return [...results].sort((a, b) => (b.experiment_count || 0) - (a.experiment_count || 0))
      case 'uplift':
        return [...results].sort(
          (a, b) => (b.lifetime_kept_normalized_delta || 0) - (a.lifetime_kept_normalized_delta || 0),
        )
      default:
        return [...results].sort((a, b) => a.title.localeCompare(b.title))
    }
  }, [listingsQuery.data?.results, sort])

  const renderMeta = (listing: ListingSummary) => (
    <>
      <span className={chipClass}>{listing.state || 'unknown'}</span>
      <span>{listing.experiment_count || 0} experiments</span>
      {typeof listing.lifetime_kept_normalized_delta === 'number' && (
        <span>Lifetime {formatPercentFromDecimal(listing.lifetime_kept_normalized_delta, 1)}</span>
      )}
      {listing.latest_views?.date && (
        <span>
          Latest views {listing.latest_views.views ?? '—'} on {formatDate(listing.latest_views.date)}
        </span>
      )}
    </>
  )

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-muted">Catalog</p>
        <h1 className={pageTitleClass}>Listings</h1>
        <p className={subtleTextClass}>Review experiment history, cumulative uplift, and quick facts for each listing.</p>
      </div>
      <div className={`${panelClass} flex flex-wrap items-center gap-4`}>
        <div className="min-w-[220px] flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Search by title or id" />
        </div>
        <Sorter label="Sort" value={sort} onChange={setSort} options={SORT_OPTIONS} />
      </div>
      {listingsQuery.isLoading && <p className={subtleTextClass}>Loading listings…</p>}
      {listingsQuery.isError && <EmptyState title="Could not load listings" description={(listingsQuery.error as Error).message} />}
      {!listingsQuery.isLoading && sortedListings.length === 0 && (
        <EmptyState title="No listings" description="Sync your shop to populate the catalog." />
      )}
      <div className="space-y-4">
        {sortedListings.map((listing) => (
          <ListingRow
            key={listing.listing_id}
            preview={listing.preview}
            meta={renderMeta(listing)}
            actions={
              <Link className={secondaryButtonClass} to={`/listings/${listing.listing_id}`}>
                Details
              </Link>
            }
          />
        ))}
      </div>
    </div>
  )
}
