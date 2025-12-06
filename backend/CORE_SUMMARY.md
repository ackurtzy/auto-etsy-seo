# Core Summary

This file is the single source of context for anyone who needs to pick up work on the Auto Etsy SEO project. It captures how the backend services, persistence model, reporting workflow, and MVP frontend interact so the system can be paused and resumed seamlessly in a new session.

## Mission & Operating Model
- Automate SEO experimentation for an Etsy stationery shop by proposing small, testable listing tweaks, applying them through Etsy's API, evaluating performance, and feeding the lessons back into future prompts.
- Everything is run locally. The Flask API (`python routes/api.py`) is meant to be started and stopped frequently; state lives on disk under `data/<shop_id>/`, so closing the app mid-run and restarting later picks up exactly where you left off after another `/sync`.
- The backend exposes a REST API, while the `frontend/index.html` file is a lightweight control panel (vanilla HTML/JS) that talks to `http://localhost:8000` and mirrors every major workflow step.

## Backend Architecture & Core Components
- `routes/api.py` hosts the Flask server with permissive CORS so the local frontend can talk to it from any port. `_get_components()` lazily wires up:
  - `ShopDataRepository` – all filesystem I/O + in-memory caches for listings, images, experiments, reports, and insights.
  - `EtsyClient` – wraps Etsy API calls for listings, images, and listing updates.
  - `SyncService` – orchestrates listing/image syncs and writes snapshots via the repository.
  - `GenerateExperimentService` – formats prompts (from `prompts/experiment_generation_system.txt` and `prompts/experiment_generation_user_template.txt`), calls OpenAI, and produces three experiment options per listing with IDs assigned immediately.
  - `ResolveExperimentService` – applies or reverts experiments through Etsy, captures baselines and snapshots, updates experiment manifests, and enforces guardrails.
  - `EvaluateExperimentService` – compares baseline vs latest performance with seasonality normalization and saves the evaluation to the experiment record.
  - `ReportService` – gathers completed experiments in a time window, uses the reporting prompt (`prompts/report_system.txt`), stores Markdown summaries + structured insights, and manages activation of those insights.
- Clients (`clients/etsy_client.py`, `clients/openai_client.py`) never touch disk; services call the repository for persistence. Helper scripts like `testing.py`, `testing_listing_changes.py`, and `testing_pipeline.py` remain available for manual workflows outside the API.

## Persistence Layout (`data/<shop_id>/`)
- `current_listings.json`: cached Etsy listing payload (with `results` array); repository exposes helpers to read/update individual listings.
- `images/images.json`: manifest keyed by listing id with downloaded files (and archived copies) for thumbnail experiments.
- `performance.json`: daily history (date → {listing_id: views}) used by evaluation and baseline capture.
- `experiments/` (the entire lifecycle state lives here):
  - `proposals.json`: the most recent bundle of exactly three options per listing (each option already has an `experiment_id`, hypothesis, payload, and cached listing/image snapshots).
  - `untested_experiments.json`: backlog dictionary `{listing_id: {experiment_id: record}}` populated when proposals are expanded; experiments stay here until manually accepted.
- `testing_experiments.json`: map of listing id → the single record currently being tested. Only one entry per listing is allowed.
- `tested_experiments.json`: map of listing id → list of completed experiments (state `kept` or `reverted`, `end_date`, evaluation results, etc.).
- `experiment_settings.json`: defaults used when generating/accepting experiments (e.g., `run_duration_days`, `generation_model`, `tolerance`).
- `reports.json`: ordered list of report objects (window metadata, Markdown report, insights array, referenced experiments, raw LLM payload).
- `active_insights.json`: current insights selected by the user for reuse in future prompting. Reports keep their own copy so history is preserved even after removal from the active registry.
- Additional folders (managed by the repository) cache images per listing and hold any archived files needed for reverts.

## Experiment Lifecycle & Guardrails
1. **Sync** (`POST /sync`): Pull listings (with optional filters: limit, keywords, listing ids, sort order) and optionally sync the image manifests. Performance history is updated so baselines can be captured later.
2. **Generate Proposals** (`POST /experiments/proposals`): For each listing id provided, the generate service fetches listing + top-three image snapshots, optional prior tested experiments (count limited by `max_prior_experiments`), and calls OpenAI for three single-variable ideas. IDs are assigned immediately so proposals, backlog entries, and future tests reference the same ID. Guardrails refuse to generate if the listing currently has an active test or any untested backlog experiments.
3. **Select Proposal Option** (`POST /experiments/proposals/<listing_id>/select`): Requires an `experiment_id`. All three proposal options are expanded into serialized experiment records (including `run_duration_days`, optional `model_used`, and cached listing/image snapshots), saved in `untested_experiments.json`, and the proposal entry is deleted so new bundles cannot be generated until the queue is cleared. The chosen record can carry a specific `start_date` before being forwarded to the accept flow.
4. **Accept / Apply Changes** (`POST /experiments/<listing>/<experiment>/accept`): Moves an experiment from the untested queue into testing. The resolve service ensures no other experiment is testing for that listing, builds the Etsy payload (respecting ≤13 tags, ≤20 characters per tag, comma-separated title clauses, etc.), archives images as needed, captures a baseline performance snapshot, applies the change through Etsy, refreshes listing images, sets `state=testing`, stamps `planned_end_date` using `run_duration_days`, and writes the record to `testing_experiments.json` while removing it from the untested manifest.
5. **Evaluate** (`POST /experiments/<listing>/<experiment>/evaluate`): Loads the experiment record, ensures a baseline exists (captured on accept), compares against the latest or requested date from `performance.json`, normalizes for whole-shop seasonality (comparison-date total views ÷ baseline total views), computes deltas, percentage changes, normalized deltas, z-score-based confidence, and a tolerance-aware recommended action (`keep`, `revert`, or `inconclusive`). Results are saved back to the experiment manifest (testing or tested).
6. **Finish / Extend**: When the planned end date arrives, the experiment is treated as `finished` while still residing in `testing_experiments.json`. You can extend the window (`POST /experiments/<listing>/<experiment>/extend`) or review a summary (`GET /experiments/<listing>/<experiment>/summary`) before deciding.
7. **Keep or Revert**: When the observation window is done, call either:
   - `POST /experiments/<listing>/<experiment>/keep`: Marks the testing record as kept, stamps `end_date`, moves it into `tested_experiments.json`, and frees the listing for new proposals.
   - `POST /experiments/<listing>/<experiment>/revert`: Restores the original listing + image order from the cached snapshot, marks the record as `reverted`, sets `end_date`, and archives it in the tested manifest.
8. **Reporting & Insight Activation**: Completed experiments (with `end_date`) can be rolled into reports, and the most valuable insights can be promoted into `active_insights.json` so future prompt runs can reuse them.

States are explicit: `proposed` (proposals/untested), `testing`, `finished` (planned end reached but awaiting user decision), `kept`, and `reverted`. The API enforces that each listing has at most one testing/finished experiment, you cannot generate another proposal if untested experiments exist, and you cannot activate an untested experiment while another is in testing.

## Reporting & Insight Workflow
- `POST /reports` accepts `{ "days_back": <int> }`, finds all tested experiments whose `end_date` falls within `[today - days_back, today]`, ensures each has up-to-date evaluation data (calling the evaluate service as needed), and constructs a compact payload per experiment:
  - `before`: title, tags, and description snapshot prior to the test.
  - `changes`: the single change payload (tags/title/description/thumbnail ordering).
  - `evaluation`: baseline vs latest metrics, normalized delta, confidence, and recommended action.
  - Any extra details stored on the experiment (`notes`, recorded performance numbers, etc.).
- That payload, plus window metadata and a scaffolded schema example, is passed to OpenAI using `prompts/report_system.txt`. The response must contain:
  - A Markdown `report.report_markdown` section that highlights wins, losses, and meta lessons.
  - An `insights` array where each entry includes a concise summary and reasoning. The service replaces placeholder IDs with UUIDs and stores them alongside the report.
- Reports are appended to `reports.json`. `GET /reports` returns the list, while `POST /reports/<report_id>/activate_insights` copies the specified insights into `active_insights.json` (stored as `{insight_id, text, reasoning, report_id}`).
- `GET /insights/active` lists the current global registry; `DELETE /insights/active/<insight_id>` removes one. History remains inside the originating report so insights can be re-activated later if desired.

## API Surface (selected endpoints)
- **Health & Sync**: `GET /health`, `POST /sync`.
- **Overview**: `GET /overview` aggregates counts/best/worst across active, finished, proposals, completed, and insights.
- **Listings**: `GET /listings` (now includes listing preview + lifetime kept uplift), `GET /listings/<listing_id>` (with query filters for IDs/title/state).
- **Images**: `GET /images/<listing_id>/<filename>` serves cached listing images for previews.
- **Proposals**: `GET /experiments/proposals`, `POST /experiments/proposals`, `POST /experiments/proposals/<listing_id>/regenerate`, `POST /experiments/proposals/<listing_id>/select`.
- **Experiments**: `GET /experiments` (supports `listing_id` and `state` filters), `GET /experiments/board` (tab-friendly inactive/proposals/active/finished/completed), `GET /experiments/testing`, `GET /experiments/finished`, `GET /experiments/untested`.
- **Lifecycle Actions**: `POST /experiments/<listing>/<experiment>/accept`, `/keep`, `/revert`, `/evaluate`, `/extend`, plus `GET /experiments/<listing>/<experiment>/summary` for “end early” dialogs.
- **Experiment defaults**: `GET/POST /experiments/settings` to persist `run_duration_days`, `generation_model`, and tolerance defaults used during proposal generation.
- **Reporting & Insights**: `GET /reports`, `POST /reports`, `POST /reports/<report_id>/activate_insights`, `GET /insights/active`, `POST /insights/active/deactivate`, `DELETE /insights/active/<insight_id>`.
- All responses are JSON; `JSON_SORT_KEYS` is disabled so payloads preserve ordering, and `flask_cors.CORS` is configured for `"/*"` origins so the local frontend works from any port.

## Frontend MVP (`frontend/index.html`)
- Split-layout UI (controls on the left, log on the right) styled with vanilla CSS. Works by opening the file directly in a browser or serving the folder via a static server.
- **Base URL Handling**: Input defaults to `http://localhost:8000` and is persisted to `localStorage` as `auto-etsy-api-base-url`.
- **Actions & Forms**:
  - Buttons call `GET /health`, `/listings`, `/experiments/proposals`, `/experiments`, `/experiments/testing`, `/experiments/untested`, `/reports`, `/insights/active`, and a `Clear Log` helper.
  - Sync form supports limit, keywords, listing IDs, sort settings, and an image-sync checkbox.
  - Listing search form filters cached listings by ID/title/state.
  - Proposal generation form requires listing IDs and offers toggles for including prior experiments + setting `max_prior_experiments`.
  - Experiment actions include accept/apply, mark kept, and revert forms (listing id + experiment id inputs).
  - Evaluation form collects listing id, experiment id, tolerance, and optional comparison date before calling the evaluate endpoint.
  - Reports panel now has three clearly labeled steps: generate a report (enter `days_back` → `POST /reports`), activate insights for reuse (`POST /reports/<report_id>/activate_insights`), and deactivate stale insights (`POST /insights/active/deactivate` with comma-separated IDs). Each action writes its result to the log so IDs can be copied/pasted without guesswork.
  - Experiments overview form hits `GET /experiments` with optional filters.
- **Logging**: `callApi()` wraps `fetch`, sets JSON headers for non-GET requests, and parses or passes through responses (falling back to raw text). `appendLog()` prepends each result to the right-hand log panel with titles and pretty-printed JSON; errors get a red border. `Clear Log` wipes the panel.
- Because the frontend mirrors every backend feature, it doubles as a regression tester: whenever the API changes, the relevant form/button can be updated here to keep parity.

## Prompts & Configuration
- Prompt files live exclusively in `prompts/`:
  - `experiment_generation_system.txt` + `experiment_generation_user_template.txt` drive the three-option generation flow (including instructions around tags/titles/descriptions/thumbnails and prior experiment avoidance).
  - `report_system.txt` teaches the LLM how to summarize experiment outcomes and emit structured insights (the scaffolded JSON example is embedded at the bottom of the service file and referenced in the prompt payload).
- `config.py` defines the `settings` singleton (dataclasses) with:
  - `shop_id`, `data_dir`, `keys_path`, and `include_prior_experiments` flag (read once from environment variables).
  - Nested `OpenAISettings` providing default model name (`gpt-5.1-2025-11-13` placeholder) and reasoning level. The clients/services read from `settings` so swapping keys/models only requires environment changes.

## Developer Notes & Guardrails
- Only the repository may read/write JSON or manipulate directories; services stay side-effect free beyond their orchestration duties.
- Guardrails to preserve:
  - One testing experiment per listing at any time.
  - No new proposals when testing or untested entries exist for that listing.
  - Accept/keep/revert routes confirm the experiment id matches the expected state before mutating data.
  - Baselines are captured when accepting experiments; evaluation fails fast if a baseline is missing.
- Reports retain the full open-ended LLM response plus normalized experiment payloads so the format can evolve without breaking the stored history. Insights stay with their reports even after being removed from the active registry.
- Whenever new functionality is added, update both this summary and the frontend panel so future sessions spin up with accurate context.
