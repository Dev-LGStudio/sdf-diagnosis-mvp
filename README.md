# SDF Diagnosis MVP

AI-powered diagnostic assistant for SDF Group agricultural machinery. Combines semantic search over workshop/operator manuals (pgvector) with structured alarm data (Supabase FTS) to surface relevant repair procedures.

## Stack

- **Frontend / API**: Next.js 15 (App Router) + TypeScript
- **Database**: Supabase (PostgreSQL + pgvector)
- **Embeddings**: Voyage AI `voyage-3` (1024-dim)
- **LLM**: Anthropic Claude

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in all values:

| Variable | Where to find |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role |
| `SUPABASE_URL` | same as `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SERVICE_KEY` | same as `SUPABASE_SERVICE_ROLE_KEY` |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `VOYAGE_API_KEY` | dash.voyageai.com |

## Setup

### Next.js app

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Python ingestion (Supabase pgvector)

```bash
# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt

# Run ingestion on one or more HTML files
python scripts/ingest_to_supabase.py data/W.239.LW1_*.html data/U.239.LW1_*.html

# Or ingest everything at once
python scripts/ingest_to_supabase.py data/*.html
```

The script reads SDF HTML exports, splits each Data Module (DM) into chunks at H2 boundaries, generates Voyage AI embeddings, and upserts everything to the `dm_chunks` table in Supabase.

**Rate limit note**: the free Voyage AI tier allows 3 requests/minute. The script sleeps 20 s between embedding batches automatically.

### Ingestion scripts

| File | Purpose |
|---|---|
| `scripts/ingest_to_supabase.py` | Canonical Python ingestion script (HTML → embeddings → Supabase) |
| `local_ingest.py` | Same script, convenient to run from project root |
| `scripts/ingest.ts` | TypeScript script for `data_modules` table (no embeddings) |
| `scripts/parsers/parseManual.ts` | HTML parser for manual files |
| `scripts/parsers/parseAlarms.ts` | CSV parser for alarm files |

### TypeScript ingestion (data_modules + alarms)

```bash
# Workshop or operator manual
npx tsx scripts/ingest.ts data/W.239.LW1_20260404_090004.html

# Alarm CSV
npx tsx scripts/ingest.ts "data/LW1 ErrorTranslations_full.csv"
```

## Database schema

| Table | Description |
|---|---|
| `dm_chunks` | Chunked DM content with `embedding vector(1024)` for semantic search |
| `data_modules` | Full DM records with FTS index, no embeddings |
| `alarms` | Alarm codes from ErrorTranslations CSV files |

SQL schemas in `supabase/schema.sql` and `supabase/migration_002.sql`.
