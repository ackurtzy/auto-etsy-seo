# Frontend Architecture

## Goals

- Modern React app with clear structure and minimal global state.
- Fast, optimistic tab transitions (items disappear from one tab and appear in the next).
- Reusable listing preview (primary image + first 30 chars; image clicks to listing detail).
- Clean separation of data fetching (React Query) and presentation (components).
- Easy to configure API base URL and experiment defaults (duration/model/tolerance).

## Tech Stack

- Vite + React (TypeScript) + React Router.
- React Query for server state; lightweight context for settings.
- CSS Modules or scoped CSS with design tokens; no heavy UI framework.

## Folder Structure (`src/`)

- `app/`
  - `App.tsx` — layout shell + route outlet.
  - `routes.tsx` — route definitions.
  - `providers/QueryProvider.tsx`, `providers/SettingsProvider.tsx`.
- `features/`
  - `overview/OverviewPage.tsx`
  - `experiments/ExperimentsPage.tsx`
    - `tabs/InactiveTab.tsx`, `ProposalsTab.tsx`, `ActiveTab.tsx`, `FinishedTab.tsx`, `CompletedTab.tsx`
  - `listings/ListingsPage.tsx`, `listings/ListingDetailPage.tsx`
  - `insights/InsightsPage.tsx`
  - `reports/ReportsPage.tsx`
- `components/`
  - `layout/` (`NavBar.tsx`, `PageShell.tsx`, `Tabs.tsx`, `StatCard.tsx`, `SearchBar.tsx`, `Sorter.tsx`, `EmptyState.tsx`)
  - `listing/` (`ListingPreview.tsx`, `ListingRow.tsx`, `ListingCheckboxList.tsx`)
  - `experiments/` (`ProposalAccordion.tsx`, `ExperimentDetails.tsx`, `PerformanceSummary.tsx`, `EndExperimentDialog.tsx`, `FinishedDecisionAccordion.tsx`)
  - `forms/` (`SyncButton.tsx`, `SettingsForm.tsx`, `GenerateProposalsForm.tsx`)
- `api/`
  - `client.js` (fetch wrapper; uses base URL from SettingsProvider)
  - `queries.js` (React Query keys + fetchers)
  - `mutations.js` (helpers for POST/PUT flows)
  - `types.js` (DTO shape references; optional JSDoc typedefs)
- `hooks/` (`useApi.ts`, `useDebouncedValue.ts`, `useCheckboxSelection.ts`)
- `styles/` (`tokens.css`, `global.css`)
- `utils/` (`format.ts`, `dates.ts`, `sorting.ts`)
- `assets/` (logo, placeholders)

## Routing

- `/` → OverviewPage
- `/experiments` → ExperimentsPage (tabs)
- `/listings` → ListingsPage
- `/listings/:id` → ListingDetailPage
- `/insights` → InsightsPage
- `/reports` → ReportsPage

## Data & API Alignment

- Overview: GET `/overview` (counts, best/worst); cards link to tabs/routes.
- Board: GET `/experiments/board` with `search`; returns inactive/proposals/active/finished/completed + counts.
- Listings: GET `/listings` (search/filter); detail via GET `/listings/:id`.
- Proposals: regenerate POST `/experiments/proposals/:id/regenerate`; select/apply POST `/experiments/proposals/:id/select`.
- Bulk generate: POST `/experiments/proposals` (run_duration/model/tolerance).
- Actions: keep/revert/extend via `/experiments/:listing/:experiment/{keep|revert|extend}`; summary via `/experiments/:listing/:experiment/summary`.
- Insights: GET/DELETE/POST (`/insights/active`, deactivate), report activation via `/reports/:id/activate_insights`.
- Settings: GET/POST `/experiments/settings`.
- Images: use `primary_image_url` from responses (`/images/:listing_id/:filename`).

## Key UI Behaviors

- ListingPreview: primary image + title (30 chars); image click → listing detail.
- NavBar: links + “Sync with Etsy” button (POST `/sync`, loading state).
- Overview: Stat cards for Active, Finished, Proposals, Insights, Completed (percent kept, avg uplift); clickable to relevant tabs/routes.
- Experiments tabs (single-column rows, sortable, searchable):
  - Inactive: checkbox list; “Generate proposals” with settings (duration/model/tolerance). Optimistic move to proposals.
  - Proposals: accordion with 3 options; select/apply; regenerate; “generating X” indicator from mutation state.
  - Active: preview + details + performance; “End early” dialog (continue/keep/revert) using `/summary` + evaluate.
  - Finished: preview + summary; actions keep/revert/extend.
  - Completed: preview + kept/reverted + performance impact.
- Listings: catalog with experiment counts and lifetime kept uplift; detail page shows images carousel, proposals/testing/history, performance chart.
- Insights: list active insights with deactivate controls; optionally activate from report.
- Reports: latest report markdown; checkbox UI to activate insights; view past reports.

## State Management

- SettingsProvider: base URL + experiment defaults (persisted in localStorage).
- React Query:
  - Queries: overview, board, listings, listingDetail, insightsActive, reports, settings.
  - Mutations: sync, generate/regenerate, select/apply, keep/revert/extend, evaluate, save settings, activate/deactivate insights.
- Optimistic updates: remove items from current tab/add to next on mutate; invalidate board/overview/listings after.

## Styling

- `tokens.css`: colors, spacing, typography, radii, shadows.
- `global.css`: reset + base styles.
- Component modules for scoped styles; flex/grid layouts.

## Utilities

- `format.ts`: numbers/percentages.
- `dates.ts`: friendly dates, relative times, sort keys.
- `sorting.ts`: sort helpers per tab (proposal date, planned end, end date).

## Critical Alignment

- Previews: use `primary_image_url` and `title_30` from backend responses.
- Generation settings: read/write via `/experiments/settings`; pass with bulk generate.
- Finished state: use finished bucket from `/experiments/board` (or `/experiments/finished`) for the Finished tab; actions via keep/revert/extend.
- Navigation links: Overview cards → correct tabs/routes; Insights card → `/insights`; Proposals card → Proposals tab.
- Consistent loading/empty/error handling via shared components.
