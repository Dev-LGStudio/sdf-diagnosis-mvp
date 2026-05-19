import { createClient } from '@supabase/supabase-js'
import { AlarmCode } from './alarmDetector'

export async function lookupAlarms(
  codes: AlarmCode[],
  model: string | null
): Promise<any[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const results: any[] = []

  for (const code of codes) {
    let query = supabase.from('alarms').select('*')

    if (model) query = query.eq('model', model)

    if (code.type === 'display_code')
      query = query.eq('display_code', code.value)
    else if (code.type === 'spn')
      query = query.eq('spn', code.value)
    else if (code.type === 'ecu')
      query = query.eq('ecu', code.value)

    const { data, error } = await query.limit(5)
    if (error) console.error('[alarmLookup] error:', error)
    if (data) results.push(...data)
  }

  return results.filter(
    (alarm, idx, arr) =>
      arr.findIndex(a => a.display_code === alarm.display_code) === idx
  )
}
