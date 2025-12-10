export interface ListingPreview {
  listing_id: number;
  title: string;
  title_30: string;
  state: string;
  primary_image_url: string | null;
}

export interface ExperimentRecord {
  listing_id: number;
  experiment_id: string;
  state: string;
  change_types?: string[];
  start_date?: string;
  end_date?: string;
  planned_end_date?: string;
  run_duration_days?: number;
  model_used?: string;
  performance?: {
    baseline?: any;
    latest?: {
      normalized_delta?: number;
      views?: number;
    };
  };
  preview: ListingPreview;
}

export interface ProposalOption {
  experiment_id: string;
  change_type: string;
  hypothesis: string;
  payload: {
    // For title experiments
    new_title?: string;
    // For description experiments
    new_description?: string;
    // For tag experiments
    tags_to_add?: string[];
    tags_to_remove?: string[];
    // For thumbnail experiments
    new_ordering?: number[];
    // Allow future fields without breaking the UI
    [key: string]: unknown;
  };
}

export interface OverviewStats {
  active_experiments: {
    count: number;
    best?: { preview: ListingPreview; normalized_delta: number };
    worst?: { preview: ListingPreview; normalized_delta: number };
  };
  finished_experiments: {
    count: number;
    best?: { preview: ListingPreview; normalized_delta: number };
    worst?: { preview: ListingPreview; normalized_delta: number };
  };
  proposals: { count: number };
  insights: { active_count: number };
  completed: {
    count: number;
    percent_kept: number;
    avg_normalized_delta_kept: number;
  };
}

export interface Report {
  report_id: string;
  created_at: string;
  window_start: string;
  window_end: string;
  report_markdown: string;
  insights: any[];
}

export interface Insight {
  insight_id: string;
  text: string;
  reasoning: string;
}
