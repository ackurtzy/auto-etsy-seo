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

## Key Constraints
- Thumbnail experiments may only reorder the first 3 images, but all listing images must remain after updates; services append untouched IDs automatically.  
- Tag edits limited to ≤13 total tags and ≤4 additions/removals.  
- Experiments stored with snapshots to enable reversion.  
- OpenAI prompt includes optional prior experiments (configurable).  

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
