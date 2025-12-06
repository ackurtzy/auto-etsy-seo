import { ApiClient } from './client'
import type { ExperimentDefaults } from '../app/providers/SettingsProvider'
import type { ExperimentSettings, SyncResponse } from './types'

export const syncShop = (api: ApiClient, payload?: Record<string, unknown>) =>
  api.post<SyncResponse>('/sync', payload)

export const generateProposals = (
  api: ApiClient,
  listingIds: number[],
  settings: ExperimentDefaults,
) =>
  api.post('/experiments/proposals', {
    listing_ids: listingIds,
    run_duration_days: settings.runDurationDays,
    experiment_duration_days: settings.runDurationDays,
    generation_model: settings.generationModel,
    tolerance: settings.tolerance,
    include_prior_experiments: settings.includePriorExperiments ?? true,
  })

export const selectProposal = (
  api: ApiClient,
  listingId: number,
  experimentId: string,
) =>
  api.post<{ listing_id: number; experiment_id: string }>(
    `/experiments/proposals/${listingId}/select`,
    { experiment_id: experimentId },
  )

export const regenerateProposal = (
  api: ApiClient,
  listingId: number,
  settings: ExperimentDefaults,
) =>
  api.post(`/experiments/proposals/${listingId}/regenerate`, {
    run_duration_days: settings.runDurationDays,
    experiment_duration_days: settings.runDurationDays,
    generation_model: settings.generationModel,
    tolerance: settings.tolerance,
    include_prior_experiments: settings.includePriorExperiments ?? true,
  })

export const saveExperimentSettings = (api: ApiClient, payload: Partial<ExperimentDefaults>) =>
  api.post<ExperimentSettings>('/experiments/settings', {
    run_duration_days: payload.runDurationDays,
    generation_model: payload.generationModel,
    tolerance: payload.tolerance,
  })

export const keepExperiment = (api: ApiClient, listingId: number, experimentId: string) =>
  api.post(`/experiments/${listingId}/${experimentId}/keep`)

export const revertExperiment = (api: ApiClient, listingId: number, experimentId: string) =>
  api.post(`/experiments/${listingId}/${experimentId}/revert`)

export const extendExperiment = (
  api: ApiClient,
  listingId: number,
  experimentId: string,
  additionalDays: number,
) => api.post(`/experiments/${listingId}/${experimentId}/extend`, { additional_days: additionalDays })

export const evaluateExperiment = (
  api: ApiClient,
  listingId: number,
  experimentId: string,
  tolerance?: number,
  comparisonDate?: string,
) =>
  api.post(`/experiments/${listingId}/${experimentId}/evaluate`, {
    tolerance,
    comparison_date: comparisonDate,
  })

export const generateReport = (api: ApiClient, daysBack: number) =>
  api.post('/reports', { days_back: daysBack })

export const activateInsightsFromReport = (
  api: ApiClient,
  reportId: string,
  insightIds: string[],
) => api.post(`/reports/${reportId}/activate_insights`, { insight_ids: insightIds })

export const deactivateInsights = (api: ApiClient, insightIds: string[]) =>
  api.post('/insights/active/deactivate', { insight_ids: insightIds })

export const deleteInsight = (api: ApiClient, insightId: string) =>
  api.delete(`/insights/active/${insightId}`)
