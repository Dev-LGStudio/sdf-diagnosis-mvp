import * as fs from 'fs'
import * as path from 'path'
import * as cheerio from 'cheerio'

export type DmRecord = {
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
  source_type: string
}

function splitList(raw: string): string[] {
  return raw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
}

export function parseManual(filePath: string): DmRecord[] {
  const html = fs.readFileSync(path.resolve(filePath), 'utf-8')
  const $ = cheerio.load(html)

  const brand        = $('div.info p.brand').text().trim()
  const familyCode   = $('div.info p.family').text().trim()
  const familyDesc   = $('div.info p.familyDescription').text().trim()
  const modelCode    = $('div.info p.model').text().trim()
  const modelDesc    = $('div.info p.modelDescription').text().trim()
  const docType      = $('div.info div.docType').text().trim()
  const creationDate = $('div.info div.creationDate').text().trim()
  const updateDate   = $('div.info div.updateDate').text().trim()

  const sourceType = docType === 'WORKSHOP MANUAL' ? 'workshop_manual' : 'operator_manual'

  console.log(`Brand: ${brand} | Model: ${modelCode} | Type: ${sourceType}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function parseDm(dmEl: cheerio.Cheerio<any>, sectionPath: string[]): DmRecord | null {
    const dmCode  = dmEl.find('> div.dmCode').text().trim()
    const dmTitle = dmEl.find('> div.dmTitle').text().trim()
    if (!dmCode || !dmTitle) return null

    return {
      dm_code:      dmCode,
      dm_version:   dmEl.find('> div.dmVersion').text().trim(),
      dm_title:     dmTitle,
      content:      dmEl.find('> div.content').html()?.trim() ?? '',
      section_path: [...sectionPath],
      spare_parts:  splitList(dmEl.find('> div.spareParts').text().trim()),
      explorer_url: dmEl.find('> div.explorer').text().trim(),
      brand,
      family_code:  familyCode,
      family_desc:  familyDesc,
      model_code:   modelCode,
      model_desc:   modelDesc,
      doc_type:     docType,
      creation_date: creationDate,
      update_date:  updateDate,
      novepunto:    splitList(dmEl.find('> div.novepunto').text().trim()),
      tags:         splitList(dmEl.find('> div.tags').text().trim()),
      service_news: dmEl.find('> div.serviceNews').html()?.trim() ?? '',
      source_type:  sourceType,
    }
  }

  const records: DmRecord[] = []
  let currentSectionPath: string[] = []

  $('body').children().each((_i, el) => {
    const node = $(el)

    if (node.hasClass('section')) {
      const items: string[] = []
      node.find('ol li').each((_j, li) => { items.push($(li).text().trim()) })
      if (items.length > 0) currentSectionPath = items

    } else if (node.hasClass('dmContainer')) {
      node.find('> div.dm').each((_j, dmNode) => {
        const record = parseDm($(dmNode), currentSectionPath)
        if (record) records.push(record)
      })

    } else if (node.hasClass('dm')) {
      const record = parseDm(node, currentSectionPath)
      if (record) records.push(record)
    }
  })

  return records
}
