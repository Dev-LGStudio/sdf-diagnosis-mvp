import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { buildSystemPrompt } from '@/lib/prompts'

export const runtime = 'nodejs'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

type DmRow = {
  dm_code: string
  dm_title: string
  section_path: string[] | null
  content: string | null
  spare_parts: string[] | null
  source_type: string | null
}

type AlarmRow = {
  alarm_code: string
  alarm_id: string
  component_en: string | null
  component_it: string | null
  description_en: string | null
  description_it: string | null
  actions_en: string | null
  actions_it: string | null
  severity: string | null
}

// Detects SDF alarm codes like A1, B12, DTC123 in the problem text
function extractAlarmCodes(problem: string): string[] {
  const matches = problem.match(/\b[A-Z]{1,3}\d+\b/g) ?? []
  return [...new Set(matches)]
}

async function fetchModules(supabase: ReturnType<typeof getSupabase>, brand: string, modelCode: string, problem: string): Promise<DmRow[]> {
  const { data: ftsData } = await supabase
    .from('data_modules')
    .select('dm_code, dm_title, section_path, content, spare_parts, source_type')
    .eq('brand', brand)
    .eq('model_code', modelCode)
    .textSearch('fts', problem, { type: 'websearch' })
    .limit(6)

  const results: DmRow[] = ftsData ?? []

  if (results.length < 3) {
    const { data: fallback } = await supabase
      .from('data_modules')
      .select('dm_code, dm_title, section_path, content, spare_parts, source_type')
      .eq('brand', brand)
      .eq('model_code', modelCode)
      .limit(4)

    const existing = new Set(results.map((r) => r.dm_code))
    for (const row of fallback ?? []) {
      if (!existing.has(row.dm_code)) results.push(row)
    }
  }

  return results
}

async function fetchAlarms(supabase: ReturnType<typeof getSupabase>, modelCode: string, problem: string): Promise<AlarmRow[]> {
  const codes = extractAlarmCodes(problem)

  // If explicit alarm codes found, prioritise exact match
  if (codes.length > 0) {
    const { data } = await supabase
      .from('alarms')
      .select('alarm_code, alarm_id, component_en, component_it, description_en, description_it, actions_en, actions_it, severity')
      .eq('model_code', modelCode)
      .in('alarm_code', codes)
      .limit(6)
    if (data && data.length > 0) return data
  }

  // Fallback: full-text search on description + component
  const keyword = problem.split(/\s+/).slice(0, 5).join(' | ')
  const { data } = await supabase
    .from('alarms')
    .select('alarm_code, alarm_id, component_en, component_it, description_en, description_it, actions_en, actions_it, severity')
    .eq('model_code', modelCode)
    .or(`description_en.ilike.%${keyword}%,component_en.ilike.%${keyword}%`)
    .limit(4)

  return data ?? []
}

function buildContext(modules: DmRow[], alarms: AlarmRow[]): string {
  const parts: string[] = []

  for (const r of modules) {
    const label = r.source_type === 'operator_manual' ? 'Manuale Uso e Manutenzione' : 'Manuale Officina'
    const section = r.section_path?.join(' > ') ?? ''
    const content = (r.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800)
    const spare = r.spare_parts?.join(', ') ?? ''
    parts.push([
      `[${label}] DM: ${r.dm_code} — ${r.dm_title}`,
      section ? `Sezione: ${section}` : '',
      content ? `Contenuto: ${content}` : '',
      spare ? `Ricambi: ${spare}` : '',
    ].filter(Boolean).join('\n'))
  }

  for (const a of alarms) {
    parts.push([
      `[Allarme] ${a.alarm_code} (${a.alarm_id}) — Severità: ${a.severity ?? 'N/D'}`,
      a.component_en ? `Componente: ${a.component_en}` : '',
      a.description_en ? `Descrizione: ${a.description_en}` : '',
      a.actions_en ? `Azioni tecnico: ${a.actions_en}` : '',
      a.actions_it ? `Azioni tecnico (IT): ${a.actions_it}` : '',
    ].filter(Boolean).join('\n'))
  }

  return parts.join('\n\n---\n\n')
}

export async function POST(req: Request) {
  const { problem, brand, modelCode } = await req.json()

  if (!problem || !brand || !modelCode) {
    return new Response('Missing required fields', { status: 400 })
  }

  const supabase = getSupabase()

  const [modules, alarms] = await Promise.all([
    fetchModules(supabase, brand, modelCode, problem),
    fetchAlarms(supabase, modelCode, problem),
  ])

  const context = buildContext(modules, alarms)

  const userMessage = context
    ? `Problema riportato dal tecnico:\n${problem}\n\nDocumentazione tecnica disponibile:\n${context}`
    : `Problema riportato dal tecnico:\n${problem}\n\n(Nessuna documentazione specifica trovata per questo modello.)`

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt(brand, modelCode),
    messages: [{ role: 'user', content: userMessage }],
  })

  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta.type === 'text_delta'
        ) {
          controller.enqueue(new TextEncoder().encode(chunk.delta.text))
        }
      }
      controller.close()
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  })
}
