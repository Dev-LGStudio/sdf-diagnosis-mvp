create table if not exists data_modules (
  id           uuid primary key default gen_random_uuid(),
  dm_code      text not null,
  dm_version   text,
  dm_title     text not null,
  content      text,
  section_path text[],
  spare_parts  text[],
  explorer_url text,
  brand        text,
  family_code  text,
  family_desc  text,
  model_code   text,
  model_desc   text,
  doc_type     text,
  created_at   timestamptz default now(),
  fts          tsvector
);

create or replace function data_modules_fts_update() returns trigger as $$
begin
  new.fts := to_tsvector('english'::regconfig,
    coalesce(new.dm_title, '') || ' ' ||
    coalesce(new.content, '') || ' ' ||
    coalesce(array_to_string(new.section_path, ' '), '')
  );
  return new;
end;
$$ language plpgsql;

create trigger data_modules_fts_trigger
  before insert or update on data_modules
  for each row execute function data_modules_fts_update();

create index if not exists dm_fts_idx on data_modules using gin(fts);
create index if not exists dm_model_idx on data_modules(brand, model_code);
create unique index if not exists dm_code_model_idx
  on data_modules(dm_code, model_code);
