import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { buildSystemPrompt } from '@/lib/prompts'

export const runtime = 'edge'

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
}

async function fetchContext(brand: string, modelCode: string, problem: string): Promise<DmRow[]> {
  const supabase = getSupabase()

  const { data: ftsData } = await supabase
    .from('data_modules')
    .select('dm_code, dm_title, section_path, content, spare_parts')
    .eq('brand', brand)
    .eq('model_code', modelCode)
    .textSearch('fts', problem, { type: 'websearch' })
    .limit(8)

  const results: DmRow[] = ftsData ?? []

  if (results.length < 3) {
    const { data: fallbackData } = await supabase
      .from('data_modules')
      .select('dm_code, dm_title, section_path, content, spare_parts')
      .eq('brand', brand)
      .eq('model_code', modelCode)
      .limit(5)

    const existingCodes = new Set(results.map((r) => r.dm_code))
    for (const row of fallbackData ?? []) {
      if (!existingCodes.has(row.dm_code)) {
        results.push(row)
      }
    }
  }

  return results
}

function buildContext(rows: DmRow[]): string {
  return rows
    .map((r) => {
      const section = r.section_path?.join(' > ') ?? ''
      const content = (r.content ?? '').slice(0, 800)
      const parts = r.spare_parts?.join(', ') ?? ''
      return [
        `DM: ${r.dm_code} — ${r.dm_title}`,
        section ? `Sezione: ${section}` : '',
        content ? `Contenuto: ${content}` : '',
        parts ? `Ricambi: ${parts}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n---\n\n')
}

export async function POST(req: Request) {
  const { problem, brand, modelCode } = await req.json()

  if (!problem || !brand || !modelCode) {
    return new Response('Missing required fields', { status: 400 })
  }

  const rows = await fetchContext(brand, modelCode, problem)
  const context = buildContext(rows)

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
