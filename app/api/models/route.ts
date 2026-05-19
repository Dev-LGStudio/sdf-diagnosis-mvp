import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

type ModelRow = {
  brand:       string
  model:       string
  model_desc:  string | null
  family_desc: string | null
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('distinct_models')
    .select('brand, model, model_desc, family_desc')
    .order('brand')
    .order('model')

  if (error) {
    console.error('[models] supabase error:', error)
    return Response.json([], { status: 500 })
  }

  return Response.json(
    (data ?? []).map((row): ModelRow => ({
      brand:       row.brand,
      model:       row.model,
      model_desc:  row.model_desc ?? null,
      family_desc: row.family_desc ?? null,
    }))
  )
}
