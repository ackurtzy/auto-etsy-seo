import clsx from 'clsx'
import { NavLink } from 'react-router-dom'
import { useSettingsContext } from '../../app/providers/SettingsProvider'
import SyncButton from '../forms/SyncButton'

const navLinks = [
  { label: 'Overview', to: '/' },
  { label: 'Experiments', to: '/experiments' },
  { label: 'Listings', to: '/listings' },
  { label: 'Insights', to: '/insights' },
  { label: 'Reports', to: '/reports' },
]

export default function NavBar() {
  const { baseUrl } = useSettingsContext()

  return (
    <header className="sticky top-0 z-20 border-b border-white/60 bg-white/90 shadow-sm backdrop-blur">
      <div className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-6 lg:px-10">
        <div className="flex flex-col">
          <span className="font-serif text-xl font-bold tracking-tight text-brand-text">Auto Etsy SEO</span>
          <span className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-muted">
            Experiment Control Center
          </span>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                clsx(
                  'rounded-full px-4 py-2 font-semibold text-brand-muted transition-colors hover:text-primary',
                  isActive && 'bg-primary/10 text-primary shadow-sm',
                )
              }
              end={link.to === '/'}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 items-center rounded-full border border-border/40 bg-surface px-4 text-xs font-semibold text-brand-muted">
            {baseUrl}
          </span>
          <SyncButton />
        </div>
      </div>
    </header>
  )
}
