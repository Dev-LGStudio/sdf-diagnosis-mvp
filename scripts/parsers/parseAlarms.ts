import * as fs from 'fs'
import * as path from 'path'

export type AlarmRecord = {
  alarm_id:           string
  alarm_code:         string
  spn:                string
  fmi:                string
  ecu:                string
  part_number:        string
  severity:           string
  component_en:       string
  component_it:       string
  description_en:     string
  description_it:     string
  full_text_en:       string
  full_text_it:       string
  actions_en:         string
  actions_it:         string
  customer_action_en: string
  customer_action_it: string
  brand:              string
  family_code:        string
  family_desc:        string
  model_code:         string
  model_desc:         string
  source_type:        string
}

// Model info lookup — CSV filename contains only model_code
const MODEL_LOOKUP: Record<string, { brand: string; family_code: string; family_desc: string; model_desc: string }> = {
  LW1: { brand: 'DEUTZ-FAHR', family_code: '239', family_desc: '6115-6125-6135 PS T5F',       model_desc: '6125 C' },
  LW8: { brand: 'DEUTZ-FAHR', family_code: '242', family_desc: '6115-6125-6135 RVSHIFT T5F',  model_desc: '6135 C RVSHIFT' },
  LW5: { brand: 'DEUTZ-FAHR', family_code: '249', family_desc: '6115-6125-6135 TTV T5F',      model_desc: '6135 C TTV' },
}

// Strip SQL-style single-quote wrapping and unescape '' → '
function clean(val: string): string {
  const s = val.trim()
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'")
  }
  return s.replace(/''/g, "'")
}

export function parseAlarms(filePath: string): AlarmRecord[] {
  // Extract model_code from filename: "LW1 ErrorTranslations_full.csv" → "LW1"
  const filename  = path.basename(filePath)
  const modelCode = filename.split(' ')[0]
  const modelInfo = MODEL_LOOKUP[modelCode]

  if (!modelInfo) {
    throw new Error(`Model code "${modelCode}" not found in MODEL_LOOKUP. Add it to parseAlarms.ts.`)
  }

  console.log(`Model: ${modelCode} | ${modelInfo.brand} ${modelInfo.model_desc}`)

  const raw  = fs.readFileSync(path.resolve(filePath), 'utf-8')
  const lines = raw.split(/\r?\n/).filter(Boolean)

  // Skip header row
  const dataLines = lines.slice(1)
  const records: AlarmRecord[] = []

  for (const line of dataLines) {
    const cols = line.split(';')
    if (cols.length < 85) continue

    const alarmId = clean(cols[0])
    if (!alarmId) continue

    records.push({
      alarm_id:           alarmId,
      alarm_code:         clean(cols[3]),   // SDF code
      spn:                clean(cols[1]),
      fmi:                clean(cols[2]),
      ecu:                clean(cols[4]),
      part_number:        clean(cols[5]),
      severity:           clean(cols[7]),   // Severity - en
      component_en:       clean(cols[40]),  // Component - en
      component_it:       clean(cols[41]),  // Component - it
      description_en:     clean(cols[51]),  // Description - en
      description_it:     clean(cols[52]),  // Description - it
      full_text_en:       clean(cols[62]),  // en (combined)
      full_text_it:       clean(cols[63]),  // it (combined)
      actions_en:         clean(cols[73]),  // Actions_en
      actions_it:         clean(cols[74]),  // Actions_it
      customer_action_en: clean(cols[84]),  // Customers_en
      customer_action_it: clean(cols[85] ?? ''), // Customers_it
      brand:              modelInfo.brand,
      family_code:        modelInfo.family_code,
      family_desc:        modelInfo.family_desc,
      model_code:         modelCode,
      model_desc:         modelInfo.model_desc,
      source_type:        'alarm',
    })
  }

  return records
}
