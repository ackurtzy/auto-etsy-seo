import type { ReactNode } from 'react'
import type { ListingPreview as Preview } from '../../api/types'
import ListingPreview from './ListingPreview'
import { panelClass } from '../../styles/shared'

type Props = {
  preview: Preview
  meta?: ReactNode
  children?: ReactNode
  actions?: ReactNode
}

export default function ListingRow({ preview, meta, children, actions }: Props) {
  return (
    <div className={`${panelClass} flex flex-col gap-4`}> 
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <ListingPreview preview={preview} className="lg:max-w-xs" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {meta && <div className="flex flex-wrap gap-3 text-sm text-brand-muted">{meta}</div>}
          {children}
        </div>
        {actions && <div className="flex flex-shrink-0 flex-col gap-2 lg:items-end">{actions}</div>}
      </div>
    </div>
  )
}
