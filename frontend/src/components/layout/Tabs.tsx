import clsx from 'clsx'

type TabItem = {
  id: string
  label: string
  count?: number
}

type TabsProps = {
  items: TabItem[]
  activeId: string
  onChange: (id: string) => void
}

export default function Tabs({ items, activeId, onChange }: TabsProps) {
  return (
    <nav
      className="flex flex-wrap gap-2 rounded-[999px] border border-white/70 bg-white/90 p-2 shadow-sm backdrop-blur"
      aria-label="Experiment tabs"
    >
      {items.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={clsx(
            'flex-1 rounded-[999px] px-5 py-2 text-sm font-semibold text-brand-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
            activeId === tab.id && 'bg-primary text-white shadow-card',
          )}
          onClick={() => onChange(tab.id)}
          aria-pressed={activeId === tab.id}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span
                className={clsx(
                  'inline-flex min-w-[2.25rem] items-center justify-center rounded-full border px-2 text-xs font-semibold',
                  activeId === tab.id
                    ? 'border-white/50 bg-white/10 text-white'
                    : 'border-border/60 bg-surface-muted text-brand-muted',
                )}
              >
                {tab.count}
              </span>
            )}
          </div>
        </button>
      ))}
    </nav>
  )
}
