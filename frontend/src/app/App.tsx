import PageShell from '../components/layout/PageShell'
import { QueryProvider } from './providers/QueryProvider'
import { SettingsProvider } from './providers/SettingsProvider'
import { AppRoutes } from './routes'

export default function App() {
  return (
    <SettingsProvider>
      <QueryProvider>
        <PageShell>
          <AppRoutes />
        </PageShell>
      </QueryProvider>
    </SettingsProvider>
  )
}
