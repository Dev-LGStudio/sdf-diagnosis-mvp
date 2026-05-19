import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { buildSystemPrompt } from '@/lib/prompts'
import { detectAlarmCodes } from '@/lib/alarmDetector'
import { lookupAlarms } from '@/lib/alarmLookup'

export const runtime = 'nodejs'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ChunkRow = {
  chunk_id:       string
  dm_code:        string
  dm_title:       string
  chunk_heading:  string | null
  chunk_text:     string
  section_path:   string | null
  spare_parts:    string[] | null
  tools_required: string[] | null
  dm_type:        string | null
  system:         string | null
  operation_type: string | null
  doc_type:       string | null
  explorer_url:   string | null
  similarity:     number
}

// ── Alarm context builder ─────────────────────────────────────────────────────
function buildAlarmContext(alarms: any[]): string {
  if (alarms.length === 0) return ''
  const blocks = alarms.map((a) => [
    `Display Code: ${a.display_code}`,
    a.ecu            ? `ECU / Component: ${a.ecu}` : '',
    a.severity       ? `Severity: ${a.severity}` : '',
    a.component_en   ? `Component name: ${a.component_en}` : '',
    `Component part number: ${a.part_number ? a.part_number : 'not available'}`,
    a.description_en ? `Fault description: ${a.description_en}` : '',
    a.actions_en     ? `Recommended actions: ${a.actions_en}` : '',
    a.customers_en   ? `Customer message: ${a.customers_en}` : '',
  ].filter(Boolean).join('\n'))

  return [
    'ALARM CODES DETECTED IN THE TECHNICIAN QUERY:',
    blocks.join('\n---\n'),
    'IMPORTANT: Use the alarm information above as PRIMARY context for your diagnosis.',
    'Cross-reference it with the technical documentation chunks below.',
  ].join('\n')
}

// ── Embedding ─────────────────────────────────────────────────────────────────
async function fetchEmbedding(text: string): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: [text],
      model: 'voyage-3',
      input_type: 'query',
    }),
  })
  if (!res.ok) throw new Error(`Voyage AI error: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.data[0].embedding
}

// ── Vector search ─────────────────────────────────────────────────────────────
async function fetchChunks(
  supabase: ReturnType<typeof getSupabase>,
  embedding: number[],
  brand: string,
  modelCode: string,
): Promise<ChunkRow[]> {
  console.log('[diagnose] embedding length:', embedding?.length)

  const { data: chunks, error } = await supabase.rpc('match_chunks', {
    query_embedding: `[${embedding.join(',')}]`,
    match_count: 8,
    filter_brand:    brand     || null,
    filter_model:    modelCode || null,
    filter_doc_type: null,
    filter_system:   null,
  })

  console.log('[diagnose] rpc error:', error)
  console.log('[diagnose] chunks trovati:', chunks?.length)

  return (chunks ?? []) as ChunkRow[]
}

// ── Context builder ───────────────────────────────────────────────────────────
function buildContext(chunks: ChunkRow[]): string {
  const parts: string[] = []

  for (const c of chunks) {
    const title  = c.chunk_heading ? `${c.dm_title} — ${c.chunk_heading}` : c.dm_title
    const label  = c.doc_type === 'WORKSHOP MANUAL' ? 'Workshop Manual' : 'Operator Manual'
    const spare  = c.spare_parts?.join(', ') ?? ''
    const tools  = c.tools_required?.join(', ') ?? ''
    const content = (c.chunk_text ?? '').slice(0, 1200)

    parts.push([
      `[${label}] DM: ${c.dm_code} — ${title}`,
      c.section_path   ? `Section: ${c.section_path}` : '',
      c.system         ? `System: ${c.system}` : '',
      c.operation_type ? `Operation: ${c.operation_type}` : '',
      content          ? `Content: ${content}` : '',
      spare            ? `Spare parts: ${spare}` : '',
      tools            ? `Tools required: ${tools}` : '',
    ].filter(Boolean).join('\n'))
  }

  return parts.join('\n\n---\n\n')
}

// ── DM references ────────────────────────────────────────────────────────────
function buildDmReferences(chunks: ChunkRow[]): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const c of chunks) {
    if (seen.has(c.dm_code)) continue
    seen.add(c.dm_code)
    const label = c.explorer_url
      ? `- ${c.dm_code} — ${c.dm_title} | Explorer: ${c.explorer_url}`
      : `- ${c.dm_code} — ${c.dm_title}`
    lines.push(label)
  }
  return lines.join('\n')
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { problem, brand, modelCode } = await req.json()

  if (!problem || !brand || !modelCode) {
    return new Response('Missing required fields', { status: 400 })
  }

  const supabase = getSupabase()

  const alarmCodes = detectAlarmCodes(problem)
  console.log('[diagnose] alarm codes detected:', alarmCodes)

  const [embedding, alarms] = await Promise.all([
    fetchEmbedding(problem),
    alarmCodes.length > 0 ? lookupAlarms(alarmCodes, modelCode) : Promise.resolve([]),
  ])
  console.log('[diagnose] alarms found:', alarms.length)

  const chunks       = await fetchChunks(supabase, embedding, brand, modelCode)
  const alarmContext = buildAlarmContext(alarms)
  console.log('[diagnose] alarm context:', alarmContext)
  const context      = buildContext(chunks)
  const dmReferences = buildDmReferences(chunks)

  const refSection = dmReferences
    ? `\n\nDM references with Explorer links (use these exact URLs in the "Riferimenti DM" section):\n${dmReferences}`
    : ''

  const userMessage = [
    `Problem reported by technician:\n${problem}`,
    alarmContext ? alarmContext : null,
    context      ? `Available technical documentation:\n${context}` : '(No specific documentation found for this model.)',
    refSection   ? refSection : null,
  ].filter(Boolean).join('\n\n')

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
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
