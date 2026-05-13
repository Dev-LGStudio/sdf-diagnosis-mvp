-- Add source_type to data_modules
ALTER TABLE data_modules
  ADD COLUMN IF NOT EXISTS source_type text;

UPDATE data_modules SET source_type = 'workshop_manual'  WHERE doc_type = 'WORKSHOP MANUAL';
UPDATE data_modules SET source_type = 'operator_manual'  WHERE doc_type = 'USE AND MAINTENANCE';

-- Alarms table (from CSV ErrorTranslations)
CREATE TABLE IF NOT EXISTS alarms (
  id                 bigint generated always as identity primary key,
  alarm_id           text not null,
  alarm_code         text not null,
  spn                text,
  fmi                text,
  ecu                text,
  part_number        text,
  severity           text,
  component_en       text,
  component_it       text,
  description_en     text,
  description_it     text,
  full_text_en       text,
  full_text_it       text,
  actions_en         text,
  actions_it         text,
  customer_action_en text,
  customer_action_it text,
  brand              text,
  family_code        text,
  family_desc        text,
  model_code         text not null,
  model_desc         text,
  source_type        text default 'alarm',
  unique (alarm_id, model_code)
);

CREATE INDEX IF NOT EXISTS alarms_model_idx ON alarms(brand, model_code);
CREATE INDEX IF NOT EXISTS alarms_code_idx  ON alarms(alarm_code);
