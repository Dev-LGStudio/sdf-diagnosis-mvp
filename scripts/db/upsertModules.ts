import { SupabaseClient } from '@supabase/supabase-js'
import { DmRecord } from '../parsers/parseManual'

export async function upsertModules(supabase: SupabaseClient, records: DmRecord[]): Promise<void> {
  let ok = 0
  let fail = 0

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    const { error } = await supabase
      .from('data_modules')
      .upsert(record, { onConflict: 'dm_code,model_code' })

    if (error) {
      console.error(`✗ [${i + 1}/${records.length}] ${record.dm_code}: ${error.message}`)
      fail++
    } else {
      console.log(`→ [${i + 1}/${records.length}] ${record.dm_code}: ${record.dm_title}`)
      ok++
    }
  }

  console.log(`\nUpsert completato: ${ok} ok, ${fail} errori.\n`)
}
