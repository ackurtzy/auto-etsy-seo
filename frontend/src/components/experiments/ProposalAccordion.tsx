import { useState } from 'react'
import type { ProposalOption, ProposalRecord } from '../../api/types'
import { chipClass, primaryButtonClass } from '../../styles/shared'

type Props = {
  proposal: ProposalRecord
  onSelect: (experimentId: string) => void
  isProcessing?: boolean
  activeExperimentId?: string | null
}

const optionTitle = (option: ProposalOption, index: number) => option.name || option.change_summary || `Option ${index + 1}`

const optionDetails = (option: ProposalOption) => {
  if (option.change_summary) return option.change_summary
  if (option.changes?.length) {
    return option.changes
      .map((change) => `${change.change_type} update`)
      .join(', ')
  }
  return option.hypothesis || option.notes || 'Experiment option'
}

export default function ProposalAccordion({ proposal, onSelect, isProcessing, activeExperimentId }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(proposal.options[0]?.experiment_id || null)

  const handleSelect = (experimentId: string) => {
    onSelect(experimentId)
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-surface-muted">
      {proposal.options.map((option, index) => {
        const isExpanded = expandedId === option.experiment_id
        return (
          <div key={option.experiment_id} className="border-b border-border/60 last:border-b-0">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
              onClick={() => setExpandedId(isExpanded ? null : option.experiment_id)}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className={chipClass}>Option {option.option_index ?? index + 1}</span>
                  <span className="font-semibold text-brand-text">{optionTitle(option, index)}</span>
                </div>
                <p className="text-sm text-brand-muted">{optionDetails(option)}</p>
              </div>
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 text-brand-muted transition ${isExpanded ? 'rotate-180' : ''}`}
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
            {isExpanded && (
              <div className="space-y-3 px-4 pb-5 text-sm text-brand-text">
                {option.hypothesis && <p className="font-semibold">Hypothesis: {option.hypothesis}</p>}
                {option.rationale && <p className="text-brand-muted">{option.rationale}</p>}
                {option.changes?.length ? (
                  <ul className="list-disc space-y-1 pl-5 text-brand-text">
                    {option.changes.map((change, changeIndex) => (
                      <li key={changeIndex} className="text-sm">
                        <span className="font-semibold capitalize">{change.change_type}</span>
                        {': '}
                        {Object.entries(change)
                          .filter(([key]) => key !== 'change_type')
                          .map(([key, value]) => `${key.replace(/_/g, ' ')}=${value}`)
                          .slice(0, 3)
                          .join(', ')}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-brand-muted">No granular changes provided.</p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className={primaryButtonClass}
                    onClick={() => handleSelect(option.experiment_id)}
                    disabled={isProcessing && activeExperimentId !== option.experiment_id}
                  >
                    {isProcessing && activeExperimentId === option.experiment_id ? 'Launching…' : 'Apply & Test'}
                  </button>
                  <p className="text-xs text-brand-muted">
                    Runs {proposal.run_duration_days || 'default'} days · Model {proposal.model_used || 'LLM'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
