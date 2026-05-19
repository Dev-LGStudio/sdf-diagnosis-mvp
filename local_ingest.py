#!/usr/bin/env python3
"""
SDF HTML manuals → Voyage AI embeddings → Supabase dm_chunks
(same logic as scripts/ingest_to_supabase.py — run this from the project root)

Usage:
    python local_ingest.py data/W.239.LW1_*.html
    python local_ingest.py data/*.html

Requires (pip install -r requirements.txt):
    beautifulsoup4, lxml, voyageai, supabase, python-dotenv

Env vars (in .env.local):
    SUPABASE_URL, SUPABASE_SERVICE_KEY, VOYAGE_API_KEY
"""

import os
import re
import sys
import time
import logging
from collections import Counter
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup, Tag
from dotenv import load_dotenv
import voyageai
from supabase import create_client

# ── Load .env.local ───────────────────────────────────────────────────────────
_here = Path(__file__).resolve().parent
for _env_path in [_here / ".env.local", _here.parent / ".env.local", Path(".env.local")]:
    if _env_path.exists():
        load_dotenv(dotenv_path=_env_path)
        break

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL         = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
VOYAGE_API_KEY       = os.environ["VOYAGE_API_KEY"]
VOYAGE_MODEL         = "voyage-3"   # 1024-dim embeddings
EMBED_BATCH          = 8
UPSERT_BATCH         = 50
RATE_LIMIT_SLEEP     = 20           # seconds between embedding batches (free tier: 3 RPM)

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)

supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
voyage_client   = voyageai.Client(api_key=VOYAGE_API_KEY)

# ── Classification maps ───────────────────────────────────────────────────────
_DM_TYPE_MAP = [
    ("general",      ["introduction", "general information", "safety", "specifications",
                      "tightening torque", "tightening class"]),
    ("engine",       ["engine", "motor", "cooling system", "lubrication", "fuel system",
                      "exhaust", "air intake", "turbocharger", "aftercooler"]),
    ("transmission", ["transmission", "gearbox", "gear", "clutch", "power take-off",
                      "pto", "drive shaft", "differential", "axle drive"]),
    ("hydraulics",   ["hydraulic", "pump", "valve", "cylinder", "hitch",
                      "lifting", "three-point", "linkage", "orbitrol"]),
    ("electrical",   ["electrical", "electric", "wiring", "battery", "alternator",
                      "starter", "sensor", "ecm", "ecu", "canbus", "instrument"]),
    ("brakes",       ["brake", "braking", "parking brake"]),
    ("steering",     ["steering", "front axle", "rear axle", "four-wheel drive", "4wd"]),
    ("cab",          ["cab", "cabin", "seat", "hvac", "air conditioning", "heating",
                      "visibility", "controls", "armrest"]),
    ("chassis",      ["chassis", "frame", "body", "exterior", "wheel", "tyre"]),
]

_SYSTEM_MAP = [
    ("cooling",           ["cooling system", "radiator", "thermostat", "coolant",
                           "water pump", "cooling fan"]),
    ("lubrication",       ["lubrication", "engine oil", "oil pump", "oil filter", "sump"]),
    ("fuel",              ["fuel system", "injection", "fuel pump", "fuel filter",
                           "diesel", "injector", "common rail"]),
    ("exhaust_emission",  ["exhaust", "dpf", "scr", "emission", "adblue", "def",
                           "after-treatment", "catalyst", "egr"]),
    ("air_intake",        ["air intake", "air filter", "turbocharger", "intercooler",
                           "aftercooler", "boost pressure"]),
    ("hydraulic_lift",    ["lifting system", "rear hitch", "front hitch",
                           "three-point", "linkage", "lift arm", "draft control"]),
    ("hydraulic_circuit", ["hydraulic pump", "hydraulic valve", "hydraulic circuit",
                           "orbitrol", "control valve", "hydraulic oil"]),
    ("pto",               ["pto", "power take-off", "rear pto", "front pto", "pto shaft"]),
    ("gearbox",           ["gearbox", "synchromesh", "range gear", "powershift",
                           "cvt", "gear lever", "gear selector"]),
    ("clutch",            ["clutch disc", "pressure plate", "clutch pedal",
                           "clutch release", "main clutch"]),
    ("braking",           ["brake system", "braking system", "park brake",
                           "brake disc", "brake pad", "brake calliper"]),
    ("steering_system",   ["steering column", "steering valve", "power steering",
                           "steering cylinder", "track rod"]),
    ("electrical_system", ["wiring harness", "fuse box", "relay", "alternator",
                           "battery", "starter motor", "ecu", "ecm", "canbus"]),
    ("cab_comfort",       ["cab seat", "hvac system", "air conditioning system",
                           "heating system", "windscreen wiper", "cab mirror"]),
]

_OPERATION_RE = {
    "removal":      re.compile(
        r"\b(remov|dismount|disassembl|dismantle|extract|detach|take[\s-]off)\b", re.I),
    "installation": re.compile(
        r"\b(install|assembl|fitting|refit|remount|reattach|mount)\b", re.I),
    "adjustment":   re.compile(
        r"\b(adjust|calibrat|setting|regulation|check|inspect|torqu|bleed|fill|replac)\b", re.I),
}


def _match_first(text: str, mapping: list) -> Optional[str]:
    t = text.lower()
    for label, kws in mapping:
        if any(k in t for k in kws):
            return label
    return None


def classify_dm_type(section_path: str) -> str:
    return _match_first(section_path, _DM_TYPE_MAP) or "general"


def classify_system(section_path: str, heading: Optional[str]) -> Optional[str]:
    return _match_first(f"{section_path} {heading or ''}", _SYSTEM_MAP)


def classify_operation(heading: Optional[str], text_preview: str) -> Optional[str]:
    probe = f"{heading or ''} {text_preview[:300]}"
    for op_type, pat in _OPERATION_RE.items():
        if pat.search(probe):
            return op_type
    return None


# ── HTML utilities ────────────────────────────────────────────────────────────
_TOOL_CODE_RE = re.compile(r"S\.T\.\d+|special tool|specific tool|tool required", re.I)


def extract_tools(content_el: Tag) -> list[str]:
    tools: list[str] = []
    for hdr in content_el.find_all(["h3", "h4"]):
        if not re.search(r"tool|equipment|attrezzatura", hdr.get_text(), re.I):
            continue
        sib = hdr.find_next_sibling()
        while sib and getattr(sib, "name", None) not in ("h1", "h2", "h3", "h4"):
            for item in sib.find_all(["li", "td", "p"]):
                t = item.get_text(" ", strip=True)
                if t and len(t) < 120:
                    tools.append(t)
            sib = sib.find_next_sibling()
    for node in content_el.find_all(string=_TOOL_CODE_RE):
        t = str(node).strip()
        if t and len(t) < 120 and t not in tools:
            tools.append(t)
    return tools[:15]


def to_plain_text(html_fragment: str) -> str:
    soup = BeautifulSoup(html_fragment, "lxml")
    raw = soup.get_text(" ", strip=True)
    return re.sub(r" {2,}", " ", raw).strip()


def split_by_h2(content_html: str) -> list[tuple[Optional[str], str, str]]:
    soup = BeautifulSoup(content_html, "lxml")
    body = soup.find("body") or soup

    sections: list[tuple[Optional[str], list]] = []
    cur_heading: Optional[str] = None
    cur_els: list = []

    for el in body.children:
        if not isinstance(el, Tag):
            continue
        if el.name == "h1":
            continue
        if el.name == "h2":
            if cur_els:
                sections.append((cur_heading, cur_els))
            cur_heading = el.get_text(strip=True)
            cur_els = [el]
        else:
            cur_els.append(el)

    if cur_els:
        sections.append((cur_heading, cur_els))

    result = []
    for heading, els in sections:
        chunk_html = "".join(str(e) for e in els)
        chunk_text = to_plain_text(chunk_html)
        if chunk_text.strip():
            result.append((heading, chunk_html, chunk_text))

    if not result:
        plain = to_plain_text(content_html)
        if plain.strip():
            return [(None, content_html, plain)]
        return []

    return result


# ── File parser ───────────────────────────────────────────────────────────────
def _text(parent: Tag, css_class: str) -> str:
    el = parent.find(class_=css_class)
    return el.get_text(strip=True) if el else ""


def _split_list(raw: str) -> list[str]:
    return [s.strip() for s in re.split(r"[\n,;]+", raw) if s.strip()]


def parse_html_file(filepath: str) -> list[dict]:
    path = Path(filepath)
    doc_type = path.name[0].upper()

    with open(path, encoding="utf-8", errors="replace") as f:
        html = f.read()

    soup = BeautifulSoup(html, "lxml")
    info = soup.find(class_="info") or soup

    brand       = _text(info, "brand")
    family      = _text(info, "family")
    family_desc = _text(info, "familyDescription")
    model       = _text(info, "model")
    model_desc  = _text(info, "modelDescription")

    log.info(f"  brand={brand}  family={family}  model={model}  doc_type={doc_type}")

    all_chunks: list[dict] = []
    chunk_counter = [0]
    current_section: list[str] = []

    def process_dm(dm_el: Tag, section_str: str) -> None:
        dm_code    = _text(dm_el, "dmCode")
        dm_version = _text(dm_el, "dmVersion")
        dm_title   = _text(dm_el, "dmTitle")
        if not dm_code or not dm_title:
            return

        explorer_url = _text(dm_el, "explorer")
        spare_parts  = _split_list(_text(dm_el, "spareParts"))
        tags         = _split_list(_text(dm_el, "tags"))
        svc_el       = dm_el.find(class_="serviceNews")
        service_news = svc_el.get_text(strip=True) or None if svc_el else None
        content_el   = dm_el.find(class_="content")
        if not content_el:
            return

        tools_required = extract_tools(content_el)
        dm_type        = classify_dm_type(section_str)
        sub_chunks     = split_by_h2(str(content_el))

        for local_idx, (heading, c_html, c_text) in enumerate(sub_chunks):
            embed_lines = [dm_title, section_str]
            if heading:
                embed_lines.append(heading)
            embed_lines.append("")
            embed_lines.append(c_text)
            embed_text = "\n".join(filter(None, embed_lines)).strip()

            all_chunks.append({
                "chunk_id":       f"{dm_code}_{local_idx}",
                "chunk_index":    chunk_counter[0],
                "dm_code":        dm_code,
                "dm_version":     dm_version,
                "dm_title":       dm_title,
                "explorer_url":   explorer_url,
                "doc_type":       doc_type,
                "source_file":    path.name,
                "brand":          brand,
                "family":         family,
                "family_desc":    family_desc,
                "model":          model,
                "model_desc":     model_desc,
                "section_path":   section_str,
                "chunk_heading":  heading,
                "dm_type":        dm_type,
                "system":         classify_system(section_str, heading),
                "operation_type": classify_operation(heading, c_text),
                "spare_parts":    spare_parts,
                "tools_required": tools_required,
                "tags":           tags,
                "service_news":   service_news,
                "chunk_text":     embed_text,
                "content_html":   c_html,
                "language":       "en",
            })
            chunk_counter[0] += 1

    body = soup.body or soup
    for child in body.children:
        if not isinstance(child, Tag):
            continue
        classes = set(child.get("class") or [])

        if "section" in classes:
            items = [li.get_text(strip=True) for li in child.find_all("li")]
            if items:
                current_section = items

        elif "dmContainer" in classes:
            sec = " > ".join(current_section)
            for dm in child.find_all("div", class_="dm", recursive=False):
                process_dm(dm, sec)

        elif "dm" in classes:
            process_dm(child, " > ".join(current_section))

    return all_chunks


# ── Embeddings ────────────────────────────────────────────────────────────────
def embed_all(chunks: list[dict]) -> list[dict]:
    total = len(chunks)
    log.info(f"\nGenerating embeddings: {total} chunks  model={VOYAGE_MODEL}")

    for start in range(0, total, EMBED_BATCH):
        batch = chunks[start : start + EMBED_BATCH]
        texts = [c["chunk_text"] for c in batch]

        result = voyage_client.embed(texts, model=VOYAGE_MODEL, input_type="document")
        for chunk, vec in zip(batch, result.embeddings):
            chunk["embedding"] = vec

        end = min(start + EMBED_BATCH, total)
        log.info(f"  embedded {end}/{total}")

        if end < total:
            time.sleep(RATE_LIMIT_SLEEP)

    return chunks


# ── Supabase upsert ───────────────────────────────────────────────────────────
def upsert_to_supabase(chunks: list[dict]) -> int:
    total = len(chunks)
    ok    = 0

    for start in range(0, total, UPSERT_BATCH):
        batch = chunks[start : start + UPSERT_BATCH]
        try:
            supabase_client.table("dm_chunks") \
                .upsert(batch, on_conflict="chunk_id") \
                .execute()
            ok += len(batch)
            end = min(start + UPSERT_BATCH, total)
            log.info(f"✓ chunk {end}/{total} — dm_code: {batch[-1]['dm_code']}")
        except Exception as exc:
            log.error(f"✗ Supabase error batch {start}–{start + len(batch)}: {exc}")

    return ok


# ── Entry point ───────────────────────────────────────────────────────────────
def main() -> None:
    files = sys.argv[1:]
    if not files:
        print("Usage: python local_ingest.py data/W.*.html [data/U.*.html ...]")
        sys.exit(1)

    all_chunks: list[dict] = []
    for fp in files:
        log.info(f"\n── Parsing {fp}")
        chunks = parse_html_file(fp)
        log.info(f"   {len(chunks)} chunk(s) extracted")
        all_chunks.extend(chunks)

    log.info(f"\nTotal chunks to process: {len(all_chunks)}")

    embed_all(all_chunks)

    log.info("\nUpserting to Supabase…")
    inserted = upsert_to_supabase(all_chunks)

    log.info(f"\n{'─' * 50}")
    log.info(f"Done. {inserted}/{len(all_chunks)} chunks upserted to dm_chunks.")
    log.info("\ndm_type distribution:")
    for dm_type, count in sorted(
        Counter(c["dm_type"] for c in all_chunks).items(), key=lambda x: -x[1]
    ):
        log.info(f"  {dm_type:<22} {count}")


if __name__ == "__main__":
    main()
