"""
ingest_alarms.py
Carica un file CSV allarmi SDF nella tabella alarms su Supabase.

Il modello viene estratto dal nome file:
  LW1_ErrorTranslations_full.csv → model = "LW1"

Uso:
  python scripts/ingest_alarms.py ../data/LW1_ErrorTranslations_full.csv
  python scripts/ingest_alarms.py ../data/*.csv
"""

import os, sys, csv, re, logging
from collections import Counter
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env.local")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase     = create_client(SUPABASE_URL, SUPABASE_KEY)
BATCH_SIZE   = 100


def clean(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    return v if v else None


def extract_model(filename: str) -> str:
    m = re.match(r'^([A-Z0-9]+)_', os.path.basename(filename))
    if not m:
        raise ValueError(f"Cannot extract model code from filename: {filename}")
    return m.group(1)


def process_file(filepath: str) -> int:
    model = extract_model(filepath)
    log.info(f"── {filepath}  (model={model})")

    rows: list[dict] = []
    with open(filepath, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")
        for raw in reader:
            display_code = clean(raw.get("ID"))
            if not display_code:
                continue
            rows.append({
                "display_code":  display_code,
                "spn":           clean(raw.get("SPN")),
                "fmi":           clean(raw.get("FMI")),
                "sdf_code":      clean(raw.get("SDF code")),
                "ecu":           clean(raw.get("ECU")),
                "part_number":   clean(raw.get("Component Part Number")),
                "severity":      clean(raw.get("Severity - en")),
                "component_en":  clean(raw.get("Component - en")),
                "description_en":clean(raw.get("Description - en")),
                "full_desc_en":  clean(raw.get("en")),
                "actions_en":    clean(raw.get("Actions_en")),
                "customers_en":  clean(raw.get("Customers_en")),
                "model":         model,
            })

    total = len(rows)
    log.info(f"  righe valide: {total}")

    inserted = 0
    for start in range(0, total, BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]
        try:
            supabase.table("alarms") \
                .upsert(batch, on_conflict="display_code,model") \
                .execute()
            inserted += len(batch)
            done = min(start + BATCH_SIZE, total)
            log.info(f"  inseriti {done}/{total}")
        except Exception as exc:
            log.error(f"  errore batch {start}-{start + len(batch)}: {exc}")

    ecu_dist = Counter(r["ecu"] for r in rows if r["ecu"])
    log.info("  ECU distribution:")
    for ecu, count in sorted(ecu_dist.items(), key=lambda x: -x[1])[:10]:
        log.info(f"    {ecu:<20} {count}")

    return inserted


def main() -> None:
    files = sys.argv[1:]
    if not files:
        print("Usage: python scripts/ingest_alarms.py ../data/*.csv")
        sys.exit(1)

    total = 0
    for filepath in files:
        total += process_file(filepath)

    log.info(f"\n{'─' * 50}")
    log.info(f"Totale righe inserite: {total}")


if __name__ == "__main__":
    main()
