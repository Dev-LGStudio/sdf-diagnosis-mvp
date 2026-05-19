"""
ingest_to_supabase.py
Parsa file HTML SDF via sdf_parser, genera embedding con Voyage AI
e salva i chunk in Supabase (tabella dm_chunks).

Uso:
    python scripts/ingest_to_supabase.py data/W.239.LW1_20260404_090004.html
    python scripts/ingest_to_supabase.py data/*.html
"""

import os
import sys
import time
import logging
import httpx
from collections import Counter
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env.local")

sys.path.insert(0, os.path.dirname(__file__))
from sdf_parser import parse_html

# ── Config ────────────────────────────────────────────────────────────────────
VOYAGE_API_KEY        = os.environ["VOYAGE_API_KEY"]
SUPABASE_URL          = os.environ["SUPABASE_URL"]
SUPABASE_KEY          = os.environ["SUPABASE_SERVICE_KEY"]
EMBEDDING_MODEL       = "voyage-3"
EMBEDDING_BATCH       = 50
MAX_CHARS             = 8000
SLEEP_BETWEEN_BATCHES = 0.3    # secondi — gestisce 3 RPM free tier

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


# ── Embeddings ────────────────────────────────────────────────────────────────
def get_embeddings(texts: list[str]) -> list[list[float]]:
    truncated = [t[:MAX_CHARS] for t in texts]
    response = httpx.post(
        "https://api.voyageai.com/v1/embeddings",
        headers={
            "Authorization": f"Bearer {VOYAGE_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "input": truncated,
            "model": EMBEDDING_MODEL,
            "input_type": "document",
        },
        timeout=60,
    )
    response.raise_for_status()
    data = response.json()
    return [item["embedding"] for item in data["data"]]


def embed_chunks_batched(chunks: list[dict]) -> None:
    total = len(chunks)
    for start in range(0, total, EMBEDDING_BATCH):
        batch = chunks[start : start + EMBEDDING_BATCH]
        texts = [c.get("content_clean", "") for c in batch]
        embeddings = get_embeddings(texts)
        for chunk, emb in zip(batch, embeddings):
            chunk["embedding"] = emb
        done = min(start + EMBEDDING_BATCH, total)
        log.info(f"  embedding {done}/{total}")
        if done < total:
            time.sleep(SLEEP_BETWEEN_BATCHES)


# ── Supabase record builder ───────────────────────────────────────────────────
def build_supabase_record(chunk: dict) -> dict:
    model_code = chunk.get("model_code", "")
    doc_type   = chunk.get("doc_type", "")
    dm_code    = chunk.get("dm_code", "")
    idx        = chunk.get("chunk_index", 0)

    return {
        # chunk identity — UNICO tra tutti i file
        "chunk_id":       f"{model_code}_{doc_type}_{dm_code}_{idx}",
        "chunk_index":    idx,
        # DM
        "dm_code":        dm_code,
        "dm_version":     chunk.get("dm_version"),
        "dm_title":       chunk.get("dm_title", ""),
        "explorer_url":   chunk.get("explorer_url"),
        # documento
        "doc_type":       doc_type,
        "source_file":    chunk.get("source_file"),
        "language":       "en",
        # applicabilità
        "brand":          chunk.get("brand"),
        "family":         chunk.get("family_code"),
        "family_desc":    chunk.get("family_desc"),
        "model":          model_code,
        "model_desc":     chunk.get("model_desc"),
        # navigazione
        "section_path":   " > ".join(chunk.get("section_path", [])),
        "chunk_heading":  chunk.get("chunk_heading"),
        # classificazione
        "dm_type":        chunk.get("dm_type"),
        "system":         chunk.get("system"),
        "operation_type": chunk.get("operation_type"),
        # metadati tecnici
        "spare_parts":    chunk.get("spare_parts", []),
        "tools_required": chunk.get("tools_required", []),
        # testo
        "chunk_text":     chunk.get("content_clean", ""),
        "content_html":   chunk.get("content_html", ""),
        # embedding
        "embedding":      chunk.get("embedding"),
    }


# ── Supabase upsert ───────────────────────────────────────────────────────────
def upsert_to_supabase(records: list[dict]) -> int:
    total = len(records)
    ok    = 0
    for start in range(0, total, 50):
        batch = records[start : start + 50]
        try:
            supabase.table("dm_chunks") \
                .upsert(batch, on_conflict="chunk_id") \
                .execute()
            ok += len(batch)
            done = min(start + 50, total)
            log.info(f"  salvati {done}/{total}")
        except Exception as exc:
            log.error(f"  errore batch {start}-{start + len(batch)}: {exc}")
    return ok


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    files = sys.argv[1:]
    if not files:
        print("Usage: python scripts/ingest_to_supabase.py data/*.html")
        sys.exit(1)

    total_inserted  = 0
    total_type_dist = Counter()

    for filepath in files:
        filename = os.path.basename(filepath)
        log.info(f"\n── {filepath}")

        chunks, bulletins = parse_html(filepath)
        log.info(f"File: {filename} | DM chunks: {len(chunks)}")

        embed_chunks_batched(chunks)

        records  = [build_supabase_record(c) for c in chunks]
        inserted = upsert_to_supabase(records)
        total_inserted += inserted

        type_dist = Counter(c["dm_type"] for c in chunks)
        for dm_type, count in sorted(type_dist.items(), key=lambda x: -x[1]):
            log.info(f"  {dm_type:<25} {count}")
        total_type_dist.update(type_dist)

    log.info(f"\n{'─' * 50}")
    log.info(f"Totale chunk inseriti: {total_inserted}")
    log.info("\ndm_type distribution (tutti i file):")
    for dm_type, count in sorted(total_type_dist.items(), key=lambda x: -x[1]):
        log.info(f"  {dm_type:<25} {count}")


if __name__ == "__main__":
    main()
