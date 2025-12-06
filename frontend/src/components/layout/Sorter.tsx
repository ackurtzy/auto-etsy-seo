type SortOption = {
  label: string
  value: string
}

type SorterProps = {
  label?: string
  value: string
  onChange: (value: string) => void
  options: SortOption[]
}

export default function Sorter({ label = 'Sort by', value, onChange, options }: SorterProps) {
  return (
    <label className="inline-flex items-center gap-3 text-sm font-semibold text-brand-muted">
      <span>{label}</span>
      <select
        className="rounded-full border border-white/80 bg-white/90 px-4 py-2 text-sm font-semibold text-brand-text shadow-sm focus:border-primary focus:outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
