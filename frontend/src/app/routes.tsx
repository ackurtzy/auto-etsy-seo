import { Navigate, Route, Routes } from 'react-router-dom'
import ExperimentsPage from '../features/experiments/ExperimentsPage'
import InsightsPage from '../features/insights/InsightsPage'
import ListingDetailPage from '../features/listings/ListingDetailPage'
import ListingsPage from '../features/listings/ListingsPage'
import OverviewPage from '../features/overview/OverviewPage'
import ReportsPage from '../features/reports/ReportsPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<OverviewPage />} />
      <Route path="/experiments" element={<ExperimentsPage />} />
      <Route path="/listings" element={<ListingsPage />} />
      <Route path="/listings/:listingId" element={<ListingDetailPage />} />
      <Route path="/insights" element={<InsightsPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
