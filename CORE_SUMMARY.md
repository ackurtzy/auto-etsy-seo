# Project Overview

## Purpose
- Backend automation for Etsy SEO experiments.  
- Key features:  
  - Etsy API client for listings, images, updates.  
  - SyncService handles fetching listings/images, saving to data folder.  
  - GenerateExperimentService uses OpenAI to propose experiments (tags, title, description, thumbnail).  
  - ResolveExperimentService applies/ reverts experiments, manages image order, archives/restores files.  
  - Testing scripts (`testing.py`, `testing_listing_changes.py`, `testing_pipeline.py`) exercise sync, manual experiment flows, and full pipeline with LLM-generated experiments.  

## Data & Structure
- Data stored under `data/<shop_id>/` with `current_listings.json`, image manifests, experiments, etc.  
- Clients (`clients/etsy_client.py`, `clients/openai_client.py`) are pure API wrappers.  
- Services own repository interactions.  
- Prompts in `prompts/`, utilities in `utils/`.  
- Proposal/test state lives beside experiments under `data/<shop_id>/experiments/`: `proposals.json` caches the latest bundle of three ideas per listing, `testing_experiments.json` keeps the single active test per listing, `untested_experiments.json` stores backlog experiments keyed by listing + experiment id, and `tested_experiments.json` tracks completed tests (kept or reverted).  

## Key Constraints
- Thumbnail experiments may only reorder the first 3 images, but all listing images must remain after updates; services append untouched IDs automatically.  
- Tag edits limited to ≤13 total tags and ≤4 additions/removals.  
- Experiments stored with snapshots to enable reversion.  
- OpenAI prompt includes optional prior experiments (configurable).  

## Local Flask API (`routes/api.py`)
- Start with `python routes/api.py` (or `FLASK_APP=routes/api.py flask run`) to serve the local web app.  
- The API wires together Sync/Generate/Resolve services plus `ShopDataRepository`, so cached data + pending actions survive restarts.  
- Endpoints overview:  
  - `POST /sync` refreshes listings/images once per session; subsequent routes operate on cached data until the next manual sync.  
  - `GET /listings` / `GET /listings/<id>` expose listing metadata, cached images, experiments, proposal/testing/untested manifests, and performance history so the frontend can drive selection.  
  - `POST /experiments/proposals` batch-generates 3 ideas per listing; `POST /experiments/proposals/<listing_id>/select` promotes the option identified by `experiment_id` into testing (ensuring only one active experiment per listing) while dropping the other two into `untested_experiments.json`.  
  - `GET /experiments/testing` and `GET /experiments/untested` surface the live/testing backlog state, while `POST /experiments/<listing>/<experiment_id>/accept|keep|revert` reuse ResolveExperimentService behaviors for lifecycle management.  
- `POST /experiments/<listing>/<experiment_id>/evaluate` compares the recorded baseline vs latest performance (seasonality-normalized) and stores confidence + recommended action.  
- `POST /reports/experiments` aggregates experiment outcomes; when `use_llm=true` it asks OpenAI for a Markdown report, otherwise returns raw data plus a fallback summary.  
- Experiment states now flow as: `proposed` (LLM idea saved), `testing` (change applied via `/accept`), then either `kept` (call `/keep` when you decide to keep the change) or `reverted` (call `/revert` to undo).  
- Proposals/testing/untested/tested manifests and performance snapshots are all persisted under `data/<shop>/experiments/`, so quitting the app mid-cycle and resuming later requires only another `/sync` if Etsy data changed.  

## Frontend MVP (`frontend/index.html`)
- Static HTML/JS tester for the local API; open the file in a browser (or serve via `python -m http.server frontend`) and point it at `http://localhost:8000`.  
- Provides quick actions for `/health`, listings, proposals, experiments, testing/untested manifests, plus forms to trigger `/sync`, `/experiments/proposals`, `/experiments/proposals/<listing>/select`, and `/experiments/<listing>/<experiment_id>/accept|keep|revert|evaluate`.  
- Logs raw JSON responses inline so you can inspect payloads without wiring up a full frontend yet.  

## Coding Guidelines
- Use services for repo interactions; clients should not touch disk.  
- Add comments sparingly, only when logic isn’t self-evident.  
- Scripts primarily for manual testing; they may prompt for user input.  
- Follow existing patterns: dataclasses for settings/models, `SyncService` for data refresh, `ResolveExperimentService` for experiment lifecycle, `GenerateExperimentService` for LLM workflows.  
- When adding features, ensure they integrate with `config.py` for environment control where appropriate.  

## Next Context Instructions
1. If modifying Etsy interactions, confirm image ordering logic and token refresh behavior remain intact.  
2. For LLM changes, update prompts + services in tandem; ensure `OpenAIClient` formatting matches current API requirements.  
3. Keep data files (`data/…`) consistent with service expectations; avoid manual edits unless necessary.  
4. Document any new config flags in `config.py` and relevant scripts/services.  
