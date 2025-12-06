import { ApiClient } from './client'
import type {
  BoardResponse,
  ExperimentSettings,
  ExperimentSummaryResponse,
  InsightsResponse,
  ListingDetailResponse,
  ListingsResponse,
  OverviewResponse,
  ProposalListResponse,
  ReportsResponse,
} from './types'

export const overviewKeys = {
  all: ['overview'] as const,
}

export const boardKeys = {
  all: (search: string) => ['experiments-board', search] as const,
}

export const proposalKeys = {
  all: ['proposals'] as const,
}

export const listingsKeys = {
  list: (search: string, state?: string | null) => ['listings', search, state] as const,
  detail: (listingId: number) => ['listing', listingId] as const,
}

export const insightsKeys = {
  all: ['insights'] as const,
}

export const reportsKeys = {
  all: ['reports'] as const,
}

export const settingsKeys = {
  all: ['experiment-settings'] as const,
}

export const summaryKeys = {
  detail: (listingId: number, experimentId: string) =>
    ['experiment-summary', listingId, experimentId] as const,
}

export const fetchOverview = (api: ApiClient) => api.get<OverviewResponse>('/overview')

export const fetchBoard = (api: ApiClient, search: string) =>
  api.get<BoardResponse>('/experiments/board', { search })

export const fetchProposals = (api: ApiClient) =>
  api.get<ProposalListResponse>('/experiments/proposals')

export const fetchListings = (api: ApiClient, search: string, state?: string | null) =>
  api.get<ListingsResponse>('/listings', { search, state })

export const fetchListingDetail = (api: ApiClient, listingId: number) =>
  api.get<ListingDetailResponse>(`/listings/${listingId}`)

export const fetchInsights = (api: ApiClient) =>
  api.get<InsightsResponse>('/insights/active')

export const fetchReports = (api: ApiClient) => api.get<ReportsResponse>('/reports')

export const fetchExperimentSummary = (
  api: ApiClient,
  listingId: number,
  experimentId: string,
) => api.get<ExperimentSummaryResponse>(`/experiments/${listingId}/${experimentId}/summary`)

export const fetchExperimentSettings = (api: ApiClient) =>
  api.get<ExperimentSettings>('/experiments/settings')
