# Auto Etsy SEO

Full-stack dashboard for managing Etsy listing experiments,
proposal generation, and analytics. The backend simulates Etsy data
and exposes a Flask API; the frontend is a React + Vite single-page
app that consumes the API.

## Project structure

```
auto-etsy-seo/
├── backend/      # Flask API, services, Etsy data snapshots
├── frontend/     # React UI (Vite, TypeScript, Tailwind)
└── README.md
```

### Backend

- Entry point: `backend/routes/api.py` (Flask app)
- Data snapshots under `backend/data/<shop_id>/...`
- Key services:
  - `services/generate_experiment_service.py` – proposal generation
  - `services/resolve_experiment_service.py` – keep/revert behavior
  - `services/evaluate_experiment_service.py` – performance calcs
- `requirements.txt` for dependencies (Flask, etc.)

**Running the backend**

```bash
cd backend
source venv/bin/activate  # if virtualenv exists
pip install -r requirements.txt
FLASK_APP=routes/api.py flask run --reload
```

### Frontend

- TypeScript React app bootstrapped with Vite
- Uses `tailwindcss` for styling and `react-router-dom` for routing
- API base is `http://localhost:8000`

**Running the frontend**

```bash
cd frontend
npm install
npm run dev
```

### Sync + data workflow

1. **Sync** (`POST /sync`) pulls latest Etsy snapshots into
   `backend/data/...` (listings, images, performance history).
2. **Proposals** (`POST /experiments/proposals`) generate up to 3
   options per listing (title/tags/description/thumbnail).
3. **Testing lifecycle**: Inactive → Proposals → Active (testing) →
   Finished → Completed. The frontend tabs mirror this flow.
4. **Evaluation** (`POST /experiments/<listing>/<experiment>/evaluate`)
   writes performance metrics back to the experiment record.

### Notable commands/API endpoints

| Endpoint/Command | Description |
| ---------------- | ----------- |
| `POST /sync` | Refresh cached Etsy data |
| `GET/POST /experiments/settings` | Update defaults (duration/model/tolerance) |
| `POST /experiments/proposals` | Generate new experiment proposals |
| `POST /experiments/proposals/<listing_id>/select` | Start an experiment |
| `POST /experiments/<listing_id>/<experiment_id>/keep|revert|extend` | Resolve or adjust a running experiment |
| `POST /experiments/<listing_id>/<experiment_id>/evaluate` | Calculate performance delta |
| `POST /reports` | Generate an LLM-backed performance report |

### Environment variables / Config

- `backend/config.py` reads Etsy shop settings (shop ID, keys).
- OpenAI API key used for proposal/report generation (see
  `backend/clients/openai_client.py`).

### Notes

- Sample data lives under `backend/data/23574688/...`, so the app
  works offline by default.
- `backend/CORE_SUMMARY.md` documents the high-level architecture.
- Frontend styling/patterns are summarized in
  `frontend/docs/ui_guidelines.md`.

