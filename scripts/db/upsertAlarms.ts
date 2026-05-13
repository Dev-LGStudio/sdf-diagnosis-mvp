import { SupabaseClient } from '@supabase/supabase-js'
import { AlarmRecord } from '../parsers/parseAlarms'

export async function upsertAlarms(supabase: SupabaseClient, records: AlarmRecord[]): Promise<void> {
  let ok = 0
  let fail = 0

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    const { error } = await supabase
      .from('alarms')
      .upsert(record, { onConflict: 'alarm_id,model_code' })

    if (error) {
      console.error(`✗ [${i + 1}/${records.length}] ${record.alarm_id}: ${error.message}`)
      fail++
    } else {
      console.log(`→ [${i + 1}/${records.length}] ${record.alarm_code} ${record.alarm_id}: ${record.description_en}`)
      ok++
    }
  }

  console.log(`\nUpsert completato: ${ok} ok, ${fail} errori.\n`)
}
