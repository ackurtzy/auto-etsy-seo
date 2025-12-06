import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import EmptyState from '../../components/layout/EmptyState'
import { activateInsightsFromReport, generateReport } from '../../api/mutations'
import { fetchReports, reportsKeys, insightsKeys } from '../../api/queries'
import { useApi } from '../../hooks/useApi'
import { formatDate } from '../../utils/dates'
import {
  inputClass,
  labelClass,
  pageTitleClass,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
  subtleTextClass,
} from '../../styles/shared'

export default function ReportsPage() {
  const api = useApi()
  const queryClient = useQueryClient()
  const reportsQuery = useQuery({
    queryKey: reportsKeys.all,
    queryFn: () => fetchReports(api),
  })
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [selectedInsightIds, setSelectedInsightIds] = useState<string[]>([])
  const [daysBack, setDaysBack] = useState(14)

  const reports = reportsQuery.data?.results || []
  const activeReport = useMemo(() => {
    if (!reports.length) return null
    if (selectedReportId) {
      return reports.find((report) => report.report_id === selectedReportId) || reports[0]
    }
    return reports[0]
  }, [reports, selectedReportId])

  useEffect(() => {
    setSelectedInsightIds([])
  }, [activeReport?.report_id])

  const generateMutation = useMutation({
    mutationFn: () => generateReport(api, daysBack),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: reportsKeys.all }),
  })

  const activateMutation = useMutation({
    mutationFn: () => {
      if (!activeReport) {
        throw new Error('Select a report before activating insights')
      }
      return activateInsightsFromReport(api, activeReport.report_id, selectedInsightIds)
    },
    onSuccess: () => {
      setSelectedInsightIds([])
      queryClient.invalidateQueries({ queryKey: insightsKeys.all })
    },
  })

  if (reportsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <p className={subtleTextClass}>Loading reports…</p>
      </div>
    )
  }

  if (reportsQuery.isError) {
    return <EmptyState title="Unable to load reports" description={(reportsQuery.error as Error).message} />
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-muted">Reports</p>
        <h1 className={pageTitleClass}>Reports</h1>
        <p className={subtleTextClass}>Review the latest summary and activate insights to keep your prompts current.</p>
      </div>
      <div className={`${panelClass} space-y-3`}>
        <h2 className="font-serif text-xl">Generate new report</h2>
        <label className="space-y-1">
          <span className={labelClass}>Days back</span>
          <input type="number" min={1} className={inputClass} value={daysBack} onChange={(event) => setDaysBack(Number(event.target.value))} />
        </label>
        <button type="button" className={primaryButtonClass} onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
          {generateMutation.isPending ? 'Generating…' : 'Generate report'}
        </button>
      </div>
      {activeReport ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={panelClass}>
            <h2 className="font-serif text-xl">Latest report</h2>
            <div className={subtleTextClass}>{formatDate(activeReport.generated_at)}</div>
            <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
              {activeReport.llm_report?.report_markdown || 'No markdown provided'}
            </div>
          </div>
          <div className={panelClass}>
            <h3 className="font-serif text-lg">Insights</h3>
            {activeReport.insights.length ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  activateMutation.mutate()
                }}
                className="grid gap-3"
              >
                {activeReport.insights.map((insight) => (
                  <label
                    key={insight.insight_id}
                    className="flex gap-3 rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border border-border/70 text-primary focus:ring-primary"
                      checked={selectedInsightIds.includes(insight.insight_id)}
                      onChange={(event) => {
                        setSelectedInsightIds((prev) =>
                          event.target.checked
                            ? [...prev, insight.insight_id]
                            : prev.filter((id) => id !== insight.insight_id),
                        )
                      }}
                    />
                    <div>
                      <span className="block font-semibold text-brand-text">{insight.text}</span>
                      <span className={subtleTextClass}>{insight.reasoning}</span>
                    </div>
                  </label>
                ))}
                <button type="submit" className={primaryButtonClass} disabled={!selectedInsightIds.length || activateMutation.isPending}>
                  {activateMutation.isPending ? 'Activating…' : 'Activate selected insights'}
                </button>
              </form>
            ) : (
              <p className={subtleTextClass}>This report did not produce any insights.</p>
            )}
          </div>
        </div>
      ) : (
        <EmptyState title="No reports yet" description="Generate your first report to review experiments." />
      )}
      {reports.length > 1 && (
        <div className={panelClass}>
          <h3 className="font-serif text-lg">Past reports</h3>
          <div className="mt-3 flex flex-wrap gap-3">
            {reports.map((report) => (
              <button
                key={report.report_id}
                type="button"
                className={secondaryButtonClass}
                onClick={() => setSelectedReportId(report.report_id)}
              >
                {formatDate(report.generated_at)} · {report.insights.length} insights
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
