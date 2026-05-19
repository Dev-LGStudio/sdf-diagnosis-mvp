-- Enable pgvector (safe to run even if already enabled)
create extension if not exists vector;

-- dm_chunks: chunked DM content with Voyage AI embeddings
create table if not exists dm_chunks (
  chunk_id        text primary key,
  chunk_index     integer not null,
  dm_code         text not null,
  dm_version      text,
  dm_title        text not null,
  explorer_url    text,
  doc_type        text,                          -- 'W' or 'U'
  source_file     text,
  brand           text,
  family          text,
  family_desc     text,
  model           text,
  model_desc      text,
  section_path    text,                          -- "SEZ1 > SEZ2 > SEZ3"
  chunk_heading   text,                          -- H2 that originated the chunk, null if single
  dm_type         text,
  system          text,
  operation_type  text,                          -- 'removal' | 'installation' | 'adjustment' | null
  spare_parts     text[],
  tools_required  text[],
  tags            text[],
  service_news    text,
  chunk_text      text not null,
  content_html    text,
  embedding       vector(1024),
  language        text not null default 'en',
  created_at      timestamptz default now()
);

-- Vector similarity index (cosine distance, IVFFlat)
-- Tune lists = sqrt(expected_rows); recreate after bulk load if needed
create index if not exists dm_chunks_embedding_idx
  on dm_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Filter indexes
create index if not exists dm_chunks_model_idx  on dm_chunks (brand, model);
create index if not exists dm_chunks_dm_code_idx on dm_chunks (dm_code);
create index if not exists dm_chunks_dm_type_idx on dm_chunks (dm_type);
