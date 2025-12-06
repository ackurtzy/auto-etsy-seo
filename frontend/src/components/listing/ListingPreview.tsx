import clsx from 'clsx'
import { Link } from 'react-router-dom'
import type { ListingPreview as Preview } from '../../api/types'
import { useSettingsContext } from '../../app/providers/SettingsProvider'
import { chipClass, eyebrowClass } from '../../styles/shared'

const resolveImage = (path: string | null | undefined, baseUrl: string) => {
  if (!path) return undefined
  if (path.startsWith('http')) return path
  return `${baseUrl}${path}`
}

type Props = {
  preview: Preview
  className?: string
  showState?: boolean
}

export default function ListingPreview({ preview, className, showState = true }: Props) {
  const { baseUrl } = useSettingsContext()
  const imageSrc = resolveImage(preview.primary_image_url, baseUrl)
  const baseTitle = preview.title || ''
  const shortTitle = preview.title_30 || (baseTitle.length > 30 ? `${baseTitle.slice(0, 30)}…` : baseTitle)

  return (
    <div className={clsx('flex min-w-0 gap-4', className)}>
      <Link
        to={`/listings/${preview.listing_id}`}
        className="group relative block h-24 w-24 overflow-hidden rounded-2xl border border-white/70 bg-surface-muted shadow-sm"
      >
        {imageSrc ? (
          <img src={imageSrc} alt={shortTitle || preview.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-brand-muted">No image</div>
        )}
        <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-full bg-slate-900/60 px-2 py-0.5 text-center text-[10px] font-semibold uppercase tracking-widest text-white opacity-0 transition group-hover:opacity-100">
          View listing
        </div>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          to={`/listings/${preview.listing_id}`}
          className="line-clamp-2 text-base font-semibold leading-snug text-brand-text transition-colors hover:text-primary"
        >
          {shortTitle || 'Untitled listing'}
        </Link>
        <span className={eyebrowClass}>#{preview.listing_id}</span>
        {showState && preview.state && <span className={`${chipClass} w-fit`}>{preview.state}</span>}
      </div>
    </div>
  )
}
