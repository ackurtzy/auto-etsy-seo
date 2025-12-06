import type { ReactNode } from 'react'
import NavBar from './NavBar'

export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col text-brand-text">
      <NavBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-12 pt-10 lg:px-10">{children}</main>
    </div>
  )
}
