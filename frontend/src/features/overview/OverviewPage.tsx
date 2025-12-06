import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import StatCard from '../../components/layout/StatCard'
import SettingsForm from '../../components/forms/SettingsForm'
import { fetchOverview, overviewKeys } from '../../api/queries'
import { useApi } from '../../hooks/useApi'
import { formatPercent, formatPercentFromDecimal } from '../../utils/format'
import EmptyState from '../../components/layout/EmptyState'
import { pageTitleClass, panelClass, secondaryButtonClass, sectionTitleClass, subtleTextClass } from '../../styles/shared'

export default function OverviewPage() {
  const api = useApi()
  const navigate = useNavigate()
  const overviewQuery = useQuery({
    queryKey: overviewKeys.all,
    queryFn: () => fetchOverview(api),
  })

  const data = overviewQuery.data

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-muted">Command center</p>
        <h1 className={pageTitleClass}>Overview</h1>
        <p className={subtleTextClass}>
          Keep tabs on every stage of the experimentation pipeline—from proposals through active tests and
          completed learnings.
        </p>
      </div>
      {overviewQuery.isLoading && <p className={subtleTextClass}>Fetching counts…</p>}
      {overviewQuery.isError && (
        <EmptyState title="Unable to load overview" description={(overviewQuery.error as Error).message} />
      )}
      {data && (
        <>
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="rounded-[28px] bg-gradient-to-br from-primary to-primary-hover p-6 text-white shadow-card">
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-white/70">Live visibility</p>
              <p className="mt-2 text-4xl font-serif font-semibold">
                {data.active_experiments.count} active · {data.proposals.count} proposals queuing
              </p>
              <p className="mt-2 text-sm text-white/80">
                {data.finished_experiments.count} finished runs need resolution—keep or revert them on the Finished tab.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  { label: 'Proposals', value: data.proposals.count, path: '/experiments?tab=proposals' },
                  { label: 'Active tests', value: data.active_experiments.count, path: '/experiments?tab=active' },
                  { label: 'Finished', value: data.finished_experiments.count, path: '/experiments?tab=finished' },
                  { label: 'Completed', value: data.completed.count, path: '/experiments?tab=completed' },
                ].map((stage) => (
                  <button
                    key={stage.label}
                    type="button"
                    onClick={() => navigate(stage.path)}
                    className="flex items-center justify-between rounded-2xl bg-white/15 px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/25"
                  >
                    <span>{stage.label}</span>
                    <span className="text-2xl">{stage.value}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={`${panelClass} h-full space-y-4`}>
              <div>
                <h2 className={sectionTitleClass}>Experiment Defaults</h2>
                <p className={subtleTextClass}>Applied whenever you bulk-generate proposals.</p>
              </div>
              <SettingsForm />
            </div>
          </div>
          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <StatCard
                title="Active Experiments"
                value={data.active_experiments.count}
                description="Monitoring live tests"
                best={data.active_experiments.best}
                worst={data.active_experiments.worst}
                onClick={() => navigate('/experiments?tab=active')}
              />
              <StatCard
                title="Finished"
                value={data.finished_experiments.count}
                description="Awaiting decision"
                best={data.finished_experiments.best}
                worst={data.finished_experiments.worst}
                onClick={() => navigate('/experiments?tab=finished')}
              />
              <StatCard
                title="Proposals"
                value={data.proposals.count}
                description="Ready to launch"
                onClick={() => navigate('/experiments?tab=proposals')}
              />
              <StatCard
                title="Completed"
                value={data.completed.count}
                description={`Kept ${formatPercent(data.completed.percent_kept)} · Avg uplift ${formatPercentFromDecimal(data.completed.avg_normalized_delta_kept, 1)}`}
                onClick={() => navigate('/experiments?tab=completed')}
              />
              <StatCard
                title="Active Insights"
                value={data.insights.active_count}
                description="Reusable learnings"
                onClick={() => navigate('/insights')}
              />
            </div>
            <div className={`${panelClass} h-fit space-y-3`}>
              <h2 className={sectionTitleClass}>Insights snapshot</h2>
              <p className={subtleTextClass}>
                {data.insights.active_count} active insights currently inform proposal prompts. Visit the insights page to manage them.
              </p>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => navigate('/insights')}
              >
                Manage insights
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
