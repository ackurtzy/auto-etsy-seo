import type { ReactNode } from 'react'
import { panelClass, subtleTextClass } from '../../styles/shared'

type EmptyStateProps = {
  title: string
  description?: ReactNode
}

export default function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className={`${panelClass} border-dashed text-center`}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-primary">
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
          <path
            d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
      <div className="mt-3 font-serif text-xl font-semibold text-brand-text">{title}</div>
      {description && <div className={`${subtleTextClass} mt-2`}>{description}</div>}
    </div>
  )
}
