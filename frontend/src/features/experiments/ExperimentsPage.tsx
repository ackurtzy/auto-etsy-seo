import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Tabs from '../../components/layout/Tabs'
import SearchBar from '../../components/layout/SearchBar'
import Sorter from '../../components/layout/Sorter'
import { boardKeys, fetchBoard, fetchProposals, proposalKeys } from '../../api/queries'
import { useApi } from '../../hooks/useApi'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useCheckboxSelection } from '../../hooks/useCheckboxSelection'
import InactiveTab from './tabs/InactiveTab'
import ProposalsTab from './tabs/ProposalsTab'
import ActiveTab from './tabs/ActiveTab'
import FinishedTab from './tabs/FinishedTab'
import CompletedTab from './tabs/CompletedTab'
import EmptyState from '../../components/layout/EmptyState'
import { pageTitleClass, panelClass, subtleTextClass } from '../../styles/shared'

const TAB_IDS = ['inactive', 'proposals', 'active', 'finished', 'completed'] as const

type TabId = (typeof TAB_IDS)[number]

const compareByDate = (key: string, direction: 'asc' | 'desc' = 'asc') => (a: any, b: any) => {
  const aTime = a?.[key] ? Date.parse(a[key]) : 0
  const bTime = b?.[key] ? Date.parse(b[key]) : 0
  return direction === 'asc' ? aTime - bTime : bTime - aTime
}

const compareByText = (selector: (value: any) => string, direction: 'asc' | 'desc' = 'asc') => (a: any, b: any) =>
  direction === 'asc'
    ? selector(a).localeCompare(selector(b))
    : selector(b).localeCompare(selector(a))

const compareByDelta = (direction: 'asc' | 'desc' = 'desc') => (a: any, b: any) => {
  const aDelta = a?.performance?.latest?.normalized_delta ?? 0
  const bDelta = b?.performance?.latest?.normalized_delta ?? 0
  return direction === 'asc' ? aDelta - bDelta : bDelta - aDelta
}

const sortOptionsByTab: Record<TabId, { value: string; label: string }[]> = {
  inactive: [
    { value: 'title-asc', label: 'Title A–Z' },
    { value: 'title-desc', label: 'Title Z–A' },
  ],
  proposals: [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'alpha', label: 'Title A–Z' },
  ],
  active: [
    { value: 'ending-soon', label: 'Ending soonest' },
    { value: 'ending-late', label: 'Ending latest' },
  ],
  finished: [
    { value: 'finished-soon', label: 'Finished soonest' },
    { value: 'finished-late', label: 'Finished latest' },
  ],
  completed: [
    { value: 'recent', label: 'Most recent' },
    { value: 'impact', label: 'Highest uplift' },
  ],
}

const sortComparators: Record<TabId, Record<string, (a: any, b: any) => number>> = {
  inactive: {
    'title-asc': compareByText((item) => item.preview?.title || ''),
    'title-desc': compareByText((item) => item.preview?.title || '', 'desc'),
  },
  proposals: {
    newest: compareByDate('generated_at', 'desc'),
    oldest: compareByDate('generated_at', 'asc'),
    alpha: compareByText((item) => item.preview?.title || ''),
  },
  active: {
    'ending-soon': compareByDate('planned_end_date', 'asc'),
    'ending-late': compareByDate('planned_end_date', 'desc'),
  },
  finished: {
    'finished-soon': compareByDate('planned_end_date', 'asc'),
    'finished-late': compareByDate('planned_end_date', 'desc'),
  },
  completed: {
    recent: compareByDate('end_date', 'desc'),
    impact: compareByDelta('desc'),
  },
}

const defaultSortSelections: Record<TabId, string> = {
  inactive: 'title-asc',
  proposals: 'newest',
  active: 'ending-soon',
  finished: 'finished-soon',
  completed: 'recent',
}

export default function ExperimentsPage() {
  const api = useApi()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const debouncedSearch = useDebouncedValue(search, 400)
  const [generatingCount, setGeneratingCount] = useState(0)
  const initialTab = (searchParams.get('tab') as TabId) || 'inactive'
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const [sortSelections, setSortSelections] = useState<Record<TabId, string>>(defaultSortSelections)

  const boardQuery = useQuery({
    queryKey: boardKeys.all(debouncedSearch),
    queryFn: () => fetchBoard(api, debouncedSearch),
  })

  const proposalsQuery = useQuery({
    queryKey: proposalKeys.all,
    queryFn: () => fetchProposals(api),
  })

  const { selectedIds, toggle, clear } = useCheckboxSelection()

  const boardData = boardQuery.data
  const tabs = useMemo(
    () => [
      { id: 'inactive', label: 'Inactive', count: boardData?.inactive.count || 0 },
      { id: 'proposals', label: 'Proposals', count: boardData?.proposals.count || 0 },
      { id: 'active', label: 'Active', count: boardData?.active.count || 0 },
      { id: 'finished', label: 'Finished', count: boardData?.finished.count || 0 },
      { id: 'completed', label: 'Completed', count: boardData?.completed.count || 0 },
    ],
    [boardData],
  )

  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value) {
      next.set(key, value)
    } else {
      next.delete(key)
    }
    setSearchParams(next, { replace: true })
  }

  const handleTabChange = (id: string) => {
    const value = id as TabId
    setActiveTab(value)
    updateParam('tab', value)
  }

  const handleSortChange = (value: string) => {
    setSortSelections((prev) => ({ ...prev, [activeTab]: value }))
  }

  const renderContent = () => {
    if (!boardData) {
      if (boardQuery.isLoading) return <p className={subtleTextClass}>Loading experiments…</p>
      if (boardQuery.isError) {
        return <EmptyState title="Failed to load board" description={(boardQuery.error as Error).message} />
      }
      return null
    }

    const sortValue = sortSelections[activeTab]
    const comparator = sortComparators[activeTab][sortValue]
    const sortItems = <T,>(items: T[]) => (comparator ? [...items].sort(comparator) : items)

    switch (activeTab) {
      case 'inactive':
        return (
          <InactiveTab
            listings={sortItems(boardData.inactive.results)}
            selectedIds={selectedIds}
            toggle={toggle}
            clear={clear}
            onGenerated={() => clear()}
            onGenerating={(count) => setGeneratingCount(count)}
          />
        )
      case 'proposals':
        return (
          <ProposalsTab
            proposals={sortItems(proposalsQuery.data?.results || [])}
            generatingCount={generatingCount}
          />
        )
      case 'active':
        return <ActiveTab entries={sortItems(boardData.active.results)} />
      case 'finished':
        return <FinishedTab entries={sortItems(boardData.finished.results)} />
      case 'completed':
        return <CompletedTab entries={sortItems(boardData.completed.results)} />
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-muted">Pipeline</p>
        <h1 className={pageTitleClass}>Experiments</h1>
        <p className={subtleTextClass}>
          Single-column rows keep each listing&apos;s preview, details, and actions connected.
        </p>
      </div>
      <div className={`${panelClass} flex flex-wrap items-center gap-4`}>
        <div className="min-w-[220px] flex-1">
          <SearchBar
            value={search}
            onChange={(value) => {
              setSearch(value)
              updateParam('search', value)
            }}
            placeholder="Search listings"
          />
        </div>
        <Sorter
          label="Sort"
          value={sortSelections[activeTab]}
          onChange={handleSortChange}
          options={sortOptionsByTab[activeTab]}
        />
      </div>
      <Tabs items={tabs} activeId={activeTab} onChange={handleTabChange} />
      {renderContent()}
    </div>
  )
}
