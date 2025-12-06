type SearchBarProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function SearchBar({ value, onChange, placeholder }: SearchBarProps) {
  return (
    <label className="flex items-center gap-3 rounded-[999px] border border-white/80 bg-white/90 px-5 py-3 shadow-sm focus-within:ring-2 focus-within:ring-primary/30">
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-brand-muted" aria-hidden="true">
        <path
          d="m21 21-4.35-4.35M10 17a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <input
        className="w-full border-none bg-transparent text-base text-brand-text placeholder:text-brand-muted focus:outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}
