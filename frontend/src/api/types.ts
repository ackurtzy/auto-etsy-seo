export type ListingPreview = {
  listing_id: number
  title: string
  title_30?: string
  state?: string
  primary_image_url?: string | null
}

export type OverviewRecord = {
  listing_id: number
  experiment_id?: string
  normalized_delta?: number | null
  preview: ListingPreview
}

export type OverviewResponse = {
  active_experiments: {
    count: number
    best?: OverviewRecord | null
    worst?: OverviewRecord | null
  }
  finished_experiments: {
    count: number
    best?: OverviewRecord | null
    worst?: OverviewRecord | null
  }
  proposals: { count: number }
  insights: { active_count: number }
  completed: {
    count: number
    percent_kept?: number | null
    avg_normalized_delta_kept?: number | null
  }
}

export type ExperimentPerformance = {
  baseline?: {
    date?: string
    views?: number
  }
  latest?: {
    date?: string
    views?: number
    delta?: number
    pct_change?: number
    normalized_delta?: number
    confidence?: number
    seasonality_factor?: number
  }
}

export type ExperimentChange = {
  change_type: string
  [key: string]: unknown
}

export type ExperimentRecord = {
  experiment_id: string
  state?: string
  start_date?: string
  end_date?: string
  planned_end_date?: string
  run_duration_days?: number
  model_used?: string
  notes?: string
  performance?: ExperimentPerformance
  changes?: ExperimentChange[]
  [key: string]: unknown
}

export type BoardProposal = {
  listing_id: number
  generated_at?: string
  option_count?: number
  run_duration_days?: number
  model_used?: string
  preview: ListingPreview
}

export type BoardExperimentEntry = {
  listing_id: number
  experiment_id: string
  state?: string
  start_date?: string
  planned_end_date?: string
  run_duration_days?: number
  model_used?: string
  end_date?: string
  performance?: ExperimentPerformance
  preview: ListingPreview
}

export type BoardResponse = {
  inactive: { count: number; results: ListingPreview[] }
  proposals: { count: number; results: BoardProposal[] }
  active: { count: number; results: BoardExperimentEntry[] }
  finished: { count: number; results: BoardExperimentEntry[] }
  completed: { count: number; results: BoardExperimentEntry[] }
}

export type ProposalOption = {
  experiment_id: string
  option_index?: number
  name?: string
  hypothesis?: string
  change_summary?: string
  notes?: string
  rationale?: string
  changes?: ExperimentChange[]
  [key: string]: unknown
}

export type ProposalRecord = {
  listing_id: number
  generated_at?: string
  run_duration_days?: number
  model_used?: string
  options: ProposalOption[]
  preview: ListingPreview
}

export type ProposalListResponse = {
  results: ProposalRecord[]
  count: number
}

export type ListingSummary = {
  listing_id: number
  title: string
  state?: string
  experiment_count?: number
  has_proposal?: boolean
  proposal_option_count?: number
  testing_experiment?: ExperimentRecord | null
  untested_count?: number
  tested_count?: number
  latest_views?: {
    date?: string
    views?: number
  } | null
  preview: ListingPreview
  lifetime_kept_normalized_delta?: number
}

export type ListingsResponse = {
  results: ListingSummary[]
  count: number
}

export type ListingDetailResponse = {
  listing: Record<string, unknown>
  images: {
    results?: Array<{ url_fullxfull?: string; url_570xN?: string }>
    files?: Array<{ path?: string }>
  }
  proposal?: ProposalRecord
  testing_experiment?: ExperimentRecord | null
  untested_experiments: Record<string, ExperimentRecord>
  tested_experiments: ExperimentRecord[]
  performance: Array<{ date: string; views?: number }>
}

export type SyncResponse = {
  listings: { count?: number; synced_results?: number }
  images: { synced_listings?: number }
  performance: { latest_date?: string; tracked_listings?: number }
  synced_at?: string
}

export type InsightRecord = {
  insight_id: string
  text: string
  reasoning?: string
  report_id?: string
}

export type InsightsResponse = {
  results: InsightRecord[]
  count: number
}

export type ReportRecord = {
  report_id: string
  generated_at: string
  window: {
    start: string
    end: string
    days_back: number
  }
  experiments: Array<{
    listing_id: number
    experiment_id: string
    state: string
    end_date?: string
    evaluation?: Record<string, unknown>
  }>
  llm_report?: {
    report_markdown?: string
  }
  insights: InsightRecord[]
}

export type ReportsResponse = {
  results: ReportRecord[]
  count: number
}

export type ExperimentSummaryResponse = {
  listing_id: number
  experiment_id: string
  record: ExperimentRecord
  evaluation?: Record<string, unknown>
  preview: ListingPreview
}

export type ExperimentSettings = {
  run_duration_days?: number
  generation_model?: string
  tolerance?: number
}
