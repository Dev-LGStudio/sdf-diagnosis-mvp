"""
sdf_parser.py
Trasforma un file HTML SDF (Workshop Manual o Operator Manual)
in una lista di chunk strutturati pronti per Supabase.

Output: lista di dict, uno per chunk, compatibile con lo schema dm_chunks.

Uso:
    from sdf_parser import parse_html
    chunks, bulletins = parse_html("W_239_LW1_20260404_090004.html")
"""

import re
import os
from bs4 import BeautifulSoup, Tag
from dataclasses import dataclass, field, asdict
from typing import Optional


# ============================================================
# MAPPATURE DETERMINISTICHE  (section path → classificazione)
# ============================================================

# Primo livello del section path → dm_type
SECTION_TYPE_MAP = {
    "method of intervention":           "procedure",
    "technical characteristics":        "technical_spec",
    "calibrations and electronic diagnosis": "calibration",
    "wiring diagrams":                  "wiring",
    "service info":                     "service_bulletin",
    "safety":                           "safety",
    "introduction":                     "reference",
}

# Pattern nel secondo livello → system
SYSTEM_PATTERNS = [
    (r"\bB0\b|engine(?! acc)",          "engine"),
    (r"\bC0\b|engine accessories",      "engine_accessories"),
    (r"\bD0\b|transmission",            "transmission"),
    (r"\bE0\b|rear axle",               "rear_axle"),
    (r"\bF0\b|front axle",              "front_axle"),
    (r"\bG0\b|bodywork|cab|platform",   "bodywork"),
    (r"\bH0\b|hydraulic",               "hydraulics"),
    (r"\bL0\b|electric",                "electrical"),
    (r"\bM0\b|front pto",               "front_pto"),
    (r"\bN0\b|front lift",              "front_lift"),
    (r"\bR0\b|rear lift",               "rear_lift"),
    (r"\bS0\b|wheels",                  "wheels"),
]

# Testo H2/heading → operation_type
OPERATION_PATTERNS = [
    (r"remov|disassembl|dismount",      "removal"),
    (r"refit|install|assembl|mount",    "installation"),
    (r"inspect|check|verif|measur",     "inspection"),
    (r"adjust|setting|calibrat",        "adjustment"),
    (r"troubleshoot|fault|diagno",      "troubleshooting"),
]

# Heading H2 che NON giustificano uno split separato
# (sono titoli generici che rimangono nel chunk precedente o da soli)
SKIP_HEADINGS = {
    "general information", "general", "overview", "introduction",
    "specifications", "key", "legend", "notes", "preliminary operations",
}


# ============================================================
# STRUTTURE DATI
# ============================================================

@dataclass
class DmChunk:
    # Documento
    doc_type:       str = ""
    brand:          str = ""
    family_code:    str = ""
    family_desc:    str = ""
    model_code:     str = ""
    model_desc:     str = ""
    # DM
    dm_code:        str = ""
    dm_version:     str = ""
    dm_title:       str = ""
    explorer_url:   str = ""
    # Chunk
    chunk_index:    int = 0
    chunk_heading:  Optional[str] = None
    # Classificazione
    dm_type:        str = "reference"
    system:         Optional[str] = None
    operation_type: Optional[str] = None
    section_path:   list = field(default_factory=list)
    # Ricambi e utensili
    spare_parts:       list = field(default_factory=list)
    tools_required:    list = field(default_factory=list)
    inline_tools:      list = field(default_factory=list)
    has_special_tools: bool = False
    # Contenuto
    content_clean:  str = ""
    content_html:   str = ""
    # Meta
    source_file:    str = ""
    doc_update_date: str = ""


@dataclass
class ServiceBulletin:
    dm_code:            str = ""
    model_code:         str = ""
    brand:              str = ""
    dm_title:           str = ""
    bulletin_type:      str = ""
    unit:               str = ""
    sub_assembly:       str = ""
    pub_date:           str = ""
    customer_complaint: str = ""
    distribution_level: str = ""
    applies_to_all:     bool = False
    source_file:        str = ""


# ============================================================
# CLASSIFICATORI
# ============================================================

def classify_type(section_path: list[str]) -> str:
    if not section_path:
        return "reference"
    first = section_path[0].lower().strip()
    for key, dm_type in SECTION_TYPE_MAP.items():
        if key in first:
            return dm_type
    return "reference"


def classify_system(section_path: list[str]) -> Optional[str]:
    # Cerca in tutti i livelli del path (di solito il secondo)
    search_text = " ".join(section_path).lower()
    for pattern, system in SYSTEM_PATTERNS:
        if re.search(pattern, search_text, re.IGNORECASE):
            return system
    return None


def classify_operation(heading: Optional[str]) -> Optional[str]:
    if not heading:
        return None
    for pattern, op_type in OPERATION_PATTERNS:
        if re.search(pattern, heading, re.IGNORECASE):
            return op_type
    return "general"


# ============================================================
# ESTRAZIONE UTENSILI INLINE
# (tabelle CODE/TITLE/TEXT dentro il content)
# ============================================================

def extract_inline_tools(content_tag: Tag) -> list[str]:
    """
    Estrae i nomi degli utensili dalle tabelle CODE/TITLE/TEXT
    presenti nel contenuto del DM.
    """
    tools = []
    for table in content_tag.find_all("table"):
        headers = [th.get_text(strip=True).upper()
                   for th in table.find_all("th")]
        if "CODE" in headers and "TITLE" in headers:
            title_idx = headers.index("TITLE")
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                if len(cells) > title_idx:
                    tool_name = cells[title_idx].get_text(strip=True)
                    if tool_name and tool_name not in tools:
                        tools.append(tool_name)
    return tools


# ============================================================
# CONVERSIONE CONTENT IN TESTO PULITO
# ============================================================

def tag_to_clean_text(tag: Tag, skip_tool_tables: bool = False) -> str:
    """
    Converte un tag BeautifulSoup in testo leggibile.
    Le tabelle CODE/TITLE vengono convertite in testo naturale.
    Le tabelle Note/Warning vengono prefissate con NOTE:.
    """
    lines = []

    for el in tag.children:
        if not isinstance(el, Tag):
            continue
        name = el.name.lower() if el.name else ""

        if name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            text = el.get_text(strip=True)
            if text:
                lines.append(f"\n{'#' * int(name[1])} {text}")

        elif name == "p":
            text = el.get_text(" ", strip=True)
            if text:
                lines.append(text)

        elif name in ("ol", "ul"):
            for i, li in enumerate(el.find_all("li", recursive=False), 1):
                # Ogni <li> può contenere <p>, <table>, testo misto
                li_parts = []
                for child in li.children:
                    if not isinstance(child, Tag):
                        t = str(child).strip()
                        if t:
                            li_parts.append(t)
                    elif child.name == "p":
                        t = child.get_text(" ", strip=True)
                        if t:
                            li_parts.append(t)
                    elif child.name == "table":
                        li_parts.append(_table_to_text(child))
                prefix = f"{i}." if name == "ol" else "-"
                step_text = " ".join(li_parts).strip()
                if step_text:
                    lines.append(f"{prefix} {step_text}")

        elif name == "table":
            lines.append(_table_to_text(el))

        elif name == "hr":
            pass  # ignoriamo

    return "\n".join(l for l in lines if l.strip())


def _table_to_text(table: Tag) -> str:
    """Converte una tabella in testo naturale."""
    headers = [th.get_text(strip=True).upper()
               for th in table.find_all("th")]

    # Tabella Note/Warning/Important
    if len(headers) == 1 and headers[0] in ("NOTE", "WARNING", "IMPORTANT", "CAUTION"):
        body_text = table.find("tbody")
        if body_text:
            text = body_text.get_text(" ", strip=True)
            return f"NOTE: {text}"

    # Tabella utensili CODE/TITLE/TEXT
    if "CODE" in headers and "TITLE" in headers:
        title_idx = headers.index("TITLE")
        text_idx = headers.index("TEXT") if "TEXT" in headers else None
        parts = []
        for row in table.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) > title_idx:
                title = cells[title_idx].get_text(strip=True)
                detail = cells[text_idx].get_text(strip=True) if text_idx and len(cells) > text_idx else ""
                if title:
                    parts.append(f"{title}{' - ' + detail if detail and detail != title else ''}")
        return "Tool required: " + "; ".join(parts) if parts else ""

    # Tabella part number: colonne p/n + Description
    header_lower = [h.lower().strip() for h in headers]
    if "p/n" in header_lower and "description" in header_lower:
        pn_idx   = header_lower.index("p/n")
        desc_idx = header_lower.index("description")
        # Cerca colonne di valori tecnici (torque, pressure, temperature, ecc.)
        value_cols = [
            i for i, h in enumerate(header_lower)
            if any(kw in h for kw in (
                "torque", "pressure", "temperature", "tolerance",
                "class", "value", "nm", "bar", "rpm", "mm"
            ))
        ]
        parts = []
        for row in table.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) <= max(pn_idx, desc_idx):
                continue
            pn   = cells[pn_idx].get_text(strip=True)
            desc = cells[desc_idx].get_text(strip=True)
            if not pn and not desc:
                continue
            # Aggiungi valori tecnici se presenti
            values = []
            for vi in value_cols:
                if len(cells) > vi:
                    v = cells[vi].get_text(strip=True)
                    if v and v not in ("-", ""):
                        col_name = headers[vi] if vi < len(headers) else ""
                        values.append(f"{col_name}: {v}" if col_name else v)
            line = f"{pn} — {desc}" if pn and desc else pn or desc
            if values:
                line += f" ({', '.join(values)})"
            parts.append(line)
        if parts:
            return "Parts:\n" + "\n".join(f"  {p}" for p in parts)

    # Tabella generica
    rows = []
    for row in table.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
        cells = [c for c in cells if c]
        if cells:
            rows.append(" | ".join(cells))
    return "\n".join(rows)


# ============================================================
# COSTRUZIONE content_clean CON PREAMBOLO
# ============================================================

def build_content_clean(
    dm_title: str,
    chunk_heading: Optional[str],
    dm_type: str,
    system: Optional[str],
    operation_type: Optional[str],
    spare_parts: list[str],
    tools_required: list[str],
    inline_tools: list[str],
    body_text: str,
) -> str:
    """
    Costruisce il testo arricchito che va nell'embedding.
    Il preambolo fornisce contesto immediato all'AI.
    """
    lines = []

    # Riga 1: titolo DM + heading chunk
    if chunk_heading:
        lines.append(f"{dm_title} — {chunk_heading}")
    else:
        lines.append(dm_title)

    # Riga 2: classificazione
    meta_parts = []
    if dm_type:
        meta_parts.append(f"Type: {dm_type.replace('_', ' ')}")
    if system:
        meta_parts.append(f"System: {system.replace('_', ' ')}")
    if operation_type:
        meta_parts.append(f"Operation: {operation_type}")
    if meta_parts:
        lines.append(" | ".join(meta_parts))

    # Riga 3: utensili speciali (novepunto)
    if tools_required:
        lines.append(f"Special tools required: {', '.join(tools_required)}")

    # Riga 4: utensili inline (nomi leggibili)
    if inline_tools:
        lines.append(f"Tools: {', '.join(inline_tools)}")

    # Riga 5: ricambi
    if spare_parts:
        lines.append(f"Spare parts: {', '.join(spare_parts)}")

    lines.append("")  # riga vuota
    lines.append(body_text)

    return "\n".join(lines).strip()


# ============================================================
# SPLIT DEL CONTENT PER H2
# ============================================================

def split_content_by_h2(content_tag: Tag):
    """
    Divide il contenuto del DM in segmenti basati sugli H2.
    Restituisce lista di (heading: str|None, children: list[Tag])

    Se non ci sono H2 significativi → restituisce [(None, tutti i figli)]
    """
    children = [c for c in content_tag.children if isinstance(c, Tag)]

    # Raccogli tutti gli H2
    h2_indices = []
    for i, child in enumerate(children):
        if child.name == "h2":
            text = child.get_text(strip=True).lower()
            if text not in SKIP_HEADINGS:
                h2_indices.append(i)

    # Nessun H2 significativo → un unico chunk
    if not h2_indices:
        return [(None, children)]

    segments = []

    # Eventuale contenuto prima del primo H2 (prefazione del DM)
    if h2_indices[0] > 0:
        pre = children[:h2_indices[0]]
        # Solo se c'è contenuto reale (non solo H1)
        real_pre = [c for c in pre if c.name not in ("h1",)]
        if real_pre:
            h1_text = next(
                (c.get_text(strip=True) for c in pre if c.name == "h1"), None
            )
            segments.append((h1_text, pre))

    # Segmenti H2
    for j, idx in enumerate(h2_indices):
        heading = children[idx].get_text(strip=True)
        end = h2_indices[j + 1] if j + 1 < len(h2_indices) else len(children)
        segment_children = children[idx:end]
        segments.append((heading, segment_children))

    return segments


# ============================================================
# PARSE SERVICE NEWS
# ============================================================

def parse_service_news(sn_tag: Tag, dm_code: str, model_code: str,
                        brand: str, dm_title: str, source_file: str) -> Optional[ServiceBulletin]:
    if not sn_tag or not sn_tag.get_text(strip=True):
        return None

    items = [li.get_text(strip=True) for li in sn_tag.find_all("li")]
    bulletin = ServiceBulletin(
        dm_code=dm_code,
        model_code=model_code,
        brand=brand,
        dm_title=dm_title,
        source_file=source_file,
    )

    for item in items:
        lower = item.lower()
        if lower.startswith("type:"):
            bulletin.bulletin_type = item[5:].strip()
        elif lower.startswith("unit:"):
            bulletin.unit = item[5:].strip()
        elif lower.startswith("sub-assembly:"):
            bulletin.sub_assembly = item[13:].strip()
        elif lower.startswith("pub. date:"):
            bulletin.pub_date = item[10:].strip()
        elif lower.startswith("customer complaint:"):
            bulletin.customer_complaint = item[19:].strip()
        elif lower.startswith("distribution level:"):
            bulletin.distribution_level = item[19:].strip()
        elif "all serial numbers" in lower:
            bulletin.applies_to_all = True

    return bulletin


# ============================================================
# FUNZIONE PRINCIPALE
# ============================================================

def parse_html(filepath: str) -> tuple[list[dict], list[dict]]:
    """
    Parsa un file HTML SDF e restituisce:
      - chunks: lista di dict (schema dm_chunks)
      - bulletins: lista di dict (schema service_bulletins)
    """
    source_file = os.path.basename(filepath)

    with open(filepath, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f, "lxml")

    # --- Metadati documento ---
    info = soup.find("div", class_="info")
    doc_type     = info.find("div", class_="docType").get_text(strip=True) if info else ""
    update_date  = info.find("div", class_="updateDate").get_text(strip=True) if info else ""
    brand        = info.find("p", class_="brand").get_text(strip=True) if info else ""
    family_code  = info.find("p", class_="family").get_text(strip=True) if info else ""
    family_desc  = info.find("p", class_="familyDescription").get_text(strip=True) if info else ""
    model_code   = info.find("p", class_="model").get_text(strip=True) if info else ""
    model_desc   = info.find("p", class_="modelDescription").get_text(strip=True) if info else ""

    doc_meta = dict(
        doc_type=doc_type,
        brand=brand,
        family_code=family_code,
        family_desc=family_desc,
        model_code=model_code,
        model_desc=model_desc,
        doc_update_date=update_date,
        source_file=source_file,
    )

    # --- Scansione body: section → dmContainer ---
    body = soup.find("body")
    current_section: list[str] = []
    all_chunks: list[dict] = []
    all_bulletins: list[dict] = []

    for child in body.children:
        if not isinstance(child, Tag):
            continue
        cls = child.get("class", [])

        if "section" in cls:
            current_section = [li.get_text(strip=True)
                                for li in child.find_all("li")]

        elif "dmContainer" in cls:
            for dm_tag in child.find_all("div", class_="dm"):
                chunks, bulletins = _process_dm(
                    dm_tag, current_section, doc_meta
                )
                all_chunks.extend(chunks)
                all_bulletins.extend(bulletins)

    return all_chunks, all_bulletins


def _process_dm(
    dm_tag: Tag,
    section_path: list[str],
    doc_meta: dict,
) -> tuple[list[dict], list[dict]]:
    """Processa un singolo <div class='dm'> e restituisce chunk + bulletin."""

    # Campi base DM
    def get(cls):
        el = dm_tag.find("div", class_=cls)
        return el.get_text(strip=True) if el else ""

    dm_code      = get("dmCode")
    dm_version   = get("dmVersion")
    dm_title     = get("dmTitle")
    explorer_url = get("explorer")

    # Spare parts e tools (novepunto)
    spare_tag = dm_tag.find("div", class_="spareParts")
    nove_tag  = dm_tag.find("div", class_="novepunto")

    spare_parts = [
        c.strip() for c in (spare_tag.get_text("\n") if spare_tag else "").split("\n")
        if c.strip()
    ]
    tools_required = [
        c.strip() for c in (nove_tag.get_text("\n") if nove_tag else "").split("\n")
        if c.strip()
    ]
    has_special_tools = bool(tools_required)

    # Service news
    sn_tag = dm_tag.find("div", class_="serviceNews")
    bulletin = parse_service_news(
        sn_tag, dm_code, doc_meta["model_code"],
        doc_meta["brand"], dm_title, doc_meta["source_file"]
    )
    bulletins = [asdict(bulletin)] if bulletin else []

    # Classificazione dal section path
    dm_type  = classify_type(section_path)
    system   = classify_system(section_path)

    # Content
    content_tag = dm_tag.find("div", class_="content")
    if not content_tag:
        # DM senza contenuto (es. solo service news)
        chunk = DmChunk(
            **doc_meta,
            dm_code=dm_code, dm_version=dm_version,
            dm_title=dm_title, explorer_url=explorer_url,
            dm_type=dm_type, system=system,
            section_path=section_path,
            spare_parts=spare_parts, tools_required=tools_required,
            has_special_tools=has_special_tools,
            content_clean=f"{dm_title}\nType: {dm_type}" + (f" | System: {system}" if system else ""),
            content_html="",
        )
        return [asdict(chunk)], bulletins

    # Utensili inline (dai tool tables nel content)
    inline_tools = extract_inline_tools(content_tag)

    # Split per H2
    segments = split_content_by_h2(content_tag)

    chunks = []
    for idx, (heading, seg_children) in enumerate(segments):
        # Ricrea un tag temporaneo con i figli del segmento
        tmp = BeautifulSoup("<div></div>", "lxml").div
        for c in seg_children:
            tmp.append(c.__copy__())

        body_text = tag_to_clean_text(tmp)
        operation_type = classify_operation(heading) if heading else None

        content_clean = build_content_clean(
            dm_title=dm_title,
            chunk_heading=heading,
            dm_type=dm_type,
            system=system,
            operation_type=operation_type,
            spare_parts=spare_parts,
            tools_required=tools_required,
            inline_tools=inline_tools,
            body_text=body_text,
        )

        chunk = DmChunk(
            **doc_meta,
            dm_code=dm_code, dm_version=dm_version,
            dm_title=dm_title, explorer_url=explorer_url,
            chunk_index=idx,
            chunk_heading=heading,
            dm_type=dm_type, system=system,
            operation_type=operation_type,
            section_path=list(section_path),
            spare_parts=spare_parts,
            tools_required=tools_required,
            inline_tools=inline_tools,
            has_special_tools=has_special_tools,
            content_clean=content_clean,
            content_html=str(tmp),
        )
        chunks.append(asdict(chunk))

    return chunks, bulletins


# ============================================================
# TEST RAPIDO (eseguibile direttamente)
# ============================================================

if __name__ == "__main__":
    import sys, json

    filepath = sys.argv[1] if len(sys.argv) > 1 else "W_239_LW1_20260404_090004.html"
    print(f"Parsing: {filepath}")
    chunks, bulletins = parse_html(filepath)

    print(f"\n✓ Chunk generati:   {len(chunks)}")
    print(f"✓ Bulletin estratti: {len(bulletins)}")

    # Distribuzione dm_type
    from collections import Counter
    type_dist = Counter(c["dm_type"] for c in chunks)
    print("\nDistribuzione dm_type:")
    for t, n in type_dist.most_common():
        print(f"  {t:<25} {n:>4}")

    # Distribuzione system
    sys_dist = Counter(c["system"] for c in chunks if c["system"])
    print("\nDistribuzione system:")
    for s, n in sys_dist.most_common():
        print(f"  {s:<25} {n:>4}")

    # Esempio chunk
    procedure_chunks = [c for c in chunks if c["dm_type"] == "procedure" and c["has_special_tools"]]
    if procedure_chunks:
        ex = procedure_chunks[0]
        print(f"\n--- Esempio chunk (procedure con utensili speciali) ---")
        print(f"dm_code:        {ex['dm_code']}")
        print(f"dm_title:       {ex['dm_title']}")
        print(f"chunk_heading:  {ex['chunk_heading']}")
        print(f"system:         {ex['system']}")
        print(f"operation_type: {ex['operation_type']}")
        print(f"spare_parts:    {ex['spare_parts']}")
        print(f"tools_required: {ex['tools_required']}")
        print(f"inline_tools:   {ex['inline_tools']}")
        print(f"\ncontent_clean (primi 600 chars):\n{ex['content_clean'][:600]}")

    # Salva JSON per ispezione
    with open("chunks_output.json", "w", encoding="utf-8") as f:
        json.dump(chunks[:20], f, ensure_ascii=False, indent=2)
    print("\n✓ Primi 20 chunk salvati in chunks_output.json")
