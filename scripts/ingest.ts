import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { parseManual } from './parsers/parseManual'
import { parseAlarms } from './parsers/parseAlarms'
import { upsertModules } from './db/upsertModules'
import { upsertAlarms } from './db/upsertAlarms'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl)    throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
if (!serviceRoleKey) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY')

// service_role bypasses RLS — use only in server-side scripts
const supabase = createClient(supabaseUrl, serviceRoleKey)

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: npx tsx scripts/ingest.ts <file>')
  console.error('  HTML manuals : ./data/W.239.LW1_....html  or  ./data/U.239.LW1_....html')
  console.error('  CSV alarms   : ./data/LW1 ErrorTranslations_full.csv')
  process.exit(1)
}

const filename = path.basename(filePath)

async function main() {
  if (filename.startsWith('W.') || filename.startsWith('U.')) {
    const records = parseManual(filePath)
    if (records.length === 0) {
      console.error('Nessun DM trovato. Controlla la struttura HTML del file.')
      process.exit(1)
    }
    console.log(`Trovati ${records.length} DM. Inizio upsert...\n`)
    await upsertModules(supabase, records)

  } else if (filename.toLowerCase().endsWith('.csv')) {
    const records = parseAlarms(filePath)
    if (records.length === 0) {
      console.error('Nessun allarme trovato. Controlla la struttura del CSV.')
      process.exit(1)
    }
    console.log(`Trovati ${records.length} allarmi. Inizio upsert...\n`)
    await upsertAlarms(supabase, records)

  } else {
    console.error(`Tipo file non riconosciuto: "${filename}"`)
    console.error('Supportati: W.*.html, U.*.html, *.csv')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
