import * as fs from 'fs'
import * as path from 'path'
import * as cheerio from 'cheerio'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
if (!serviceRoleKey) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY')

// service_role bypasses RLS — use only in server-side scripts
const supabase = createClient(supabaseUrl, serviceRoleKey)

const htmlFile = process.argv[2]
if (!htmlFile) {
  console.error('Usage: npx tsx scripts/ingest.ts ./data/NOMEFILE.html')
  process.exit(1)
}

const html = fs.readFileSync(path.resolve(htmlFile), 'utf-8')
const $ = cheerio.load(html)

const brand = $('div.info p.brand').text().trim()
const familyCode = $('div.info p.family').text().trim()
const familyDesc = $('div.info p.familyDescription').text().trim()
const modelCode = $('div.info p.model').text().trim()
const modelDesc = $('div.info p.modelDescription').text().trim()
const docType = $('div.info div.docType').text().trim()
const creationDate = $('div.info div.creationDate').text().trim()
const updateDate = $('div.info div.updateDate').text().trim()

console.log(`Brand: ${brand} | Model: ${modelCode} (${modelDesc})`)

type DmRecord = {
  dm_code: string
  dm_version: string
  dm_title: string
  content: string
  section_path: string[]
  spare_parts: string[]
  explorer_url: string
  brand: string
  family_code: string
  family_desc: string
  model_code: string
  model_desc: string
  doc_type: string
  creation_date: string
  update_date: string
  novepunto: string[]
  tags: string[]
  service_news: string
}

function splitList(raw: string): string[] {
  return raw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDm(dmEl: cheerio.Cheerio<any>, currentSectionPath: string[]): DmRecord | null {
  const dmCode = dmEl.find('> div.dmCode').text().trim()
  const dmTitle = dmEl.find('> div.dmTitle').text().trim()

  if (!dmCode || !dmTitle) return null

  const dmVersion = dmEl.find('> div.dmVersion').text().trim()
  const explorerUrl = dmEl.find('> div.explorer').text().trim()
  const spareParts = splitList(dmEl.find('> div.spareParts').text().trim())
  const novepunto = splitList(dmEl.find('> div.novepunto').text().trim())
  const tags = splitList(dmEl.find('> div.tags').text().trim())
  const content = dmEl.find('> div.content').html()?.trim() ?? ''
  const serviceNews = dmEl.find('> div.serviceNews').html()?.trim() ?? ''

  return {
    dm_code: dmCode,
    dm_version: dmVersion,
    dm_title: dmTitle,
    content,
    section_path: [...currentSectionPath],
    spare_parts: spareParts,
    explorer_url: explorerUrl,
    brand,
    family_code: familyCode,
    family_desc: familyDesc,
    model_code: modelCode,
    model_desc: modelDesc,
    doc_type: docType,
    creation_date: creationDate,
    update_date: updateDate,
    novepunto,
    tags,
    service_news: serviceNews,
  }
}

const records: DmRecord[] = []
let currentSectionPath: string[] = []

$('body').children().each((_i, el) => {
  const node = $(el)

  if (node.hasClass('section')) {
    const items: string[] = []
    node.find('ol li').each((_j, li) => {
      items.push($(li).text().trim())
    })
    if (items.length > 0) currentSectionPath = items

  } else if (node.hasClass('dmContainer')) {
    // dmContainer may hold multiple div.dm children
    node.find('> div.dm').each((_j, dmNode) => {
      const record = parseDm($(dmNode), currentSectionPath)
      if (record) records.push(record)
    })

  } else if (node.hasClass('dm')) {
    const record = parseDm(node, currentSectionPath)
    if (record) records.push(record)
  }
})

if (records.length === 0) {
  console.error('Nessun DM trovato. Controlla la struttura HTML del file.')
  process.exit(1)
}

console.log(`Trovati ${records.length} DM. Inizio upsert...\n`)

async function main() {
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
  console.log(`\nIngest completato: ${ok} ok, ${fail} errori.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
