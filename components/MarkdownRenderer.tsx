'use client'

import React from 'react'

function parseInline(text: string): React.ReactNode[] {
  const regex = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g
  const nodes: React.ReactNode[] = []
  let last = 0
  let n = 0
  let m: RegExpExecArray | null

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      nodes.push(<strong key={n++} className="font-bold text-[#F0F0F0]">{m[1]}</strong>)
    } else if (m[2] !== undefined) {
      nodes.push(
        <a key={n++} href={m[3]} target="_blank" rel="noopener noreferrer"
           className="text-[#F4821E] underline underline-offset-2 hover:opacity-80 break-all">
          {m[2]}
        </a>
      )
    } else if (m[4] !== undefined) {
      nodes.push(
        <code key={n++} className="bg-[#2a2a2a] border border-[#333] px-1.5 py-0.5 rounded text-xs font-mono text-[#F4821E]">
          {m[4]}
        </code>
      )
    }
    last = regex.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export default function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Horizontal rule
    if (line.trim() === '---') {
      elements.push(<hr key={key++} className="border-[#333333] my-4" />)
      i++
      continue
    }

    // H2
    const h2 = line.match(/^## (.+)/)
    if (h2) {
      elements.push(
        <h2 key={key++} className="text-[#F4821E] font-bold text-xs uppercase tracking-widest mt-6 mb-2 pb-1.5 border-b border-[#333333]">
          {parseInline(h2[1])}
        </h2>
      )
      i++; continue
    }

    // H3
    const h3 = line.match(/^### (.+)/)
    if (h3) {
      elements.push(
        <h3 key={key++} className="text-[#F0F0F0] font-semibold text-sm mt-4 mb-1">
          {parseInline(h3[1])}
        </h3>
      )
      i++; continue
    }

    // **Bold-only line** — Claude's section headers (e.g. **Causa probabile**)
    if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
      const text = line.trim().slice(2, -2)
      elements.push(
        <p key={key++} className="text-[#F4821E] font-bold text-xs uppercase tracking-widest mt-6 mb-2">
          {text}
        </p>
      )
      i++; continue
    }

    // Ordered list — collect consecutive numbered lines
    if (/^\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const num  = lines[i].match(/^(\d+)\.\s/)?.[1] ?? ''
        const text = lines[i].replace(/^\d+\.\s/, '')
        items.push(
          <li key={i} className="flex gap-2.5 text-sm text-[#D0D0D0] leading-relaxed">
            <span className="text-[#F4821E] font-mono text-xs pt-px select-none flex-shrink-0 w-4 text-right">{num}.</span>
            <span className="min-w-0 break-words">{parseInline(text)}</span>
          </li>
        )
        i++
      }
      elements.push(<ol key={key++} className="space-y-1.5 my-2">{items}</ol>)
      continue
    }

    // Unordered list
    if (/^[-*] /.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        const text = lines[i].replace(/^[-*] /, '')
        items.push(
          <li key={i} className="flex gap-2.5 text-sm text-[#D0D0D0] leading-relaxed">
            <span className="text-[#F4821E] select-none flex-shrink-0 pt-px">▸</span>
            <span className="min-w-0 break-words">{parseInline(text)}</span>
          </li>
        )
        i++
      }
      elements.push(<ul key={key++} className="space-y-1.5 my-2">{items}</ul>)
      continue
    }

    // Table — collect header + separator + rows
    if (/^\|/.test(line)) {
      const tableLines: string[] = []
      while (i < lines.length && /^\|/.test(lines[i].trim())) {
        tableLines.push(lines[i])
        i++
      }
      // Find separator row index (|---|---|)
      const sepIdx = tableLines.findIndex(l => /^\|[\s|:-]+\|$/.test(l.trim()))
      if (sepIdx > 0) {
        const parseRow = (row: string) =>
          row.split('|').slice(1, -1).map(cell => cell.trim())
        const headers = parseRow(tableLines[0])
        const rows    = tableLines.filter((_, idx) => idx !== 0 && idx !== sepIdx)
        elements.push(
          <div key={key++} className="overflow-x-auto my-3">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  {headers.map((h, hi) => (
                    <th key={hi} className="text-left text-[10px] font-bold uppercase tracking-widest text-[#AAAAAA] px-3 py-2 border-b border-[#555555] bg-[#3a3a3a] whitespace-nowrap">
                      {parseInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-[#3D3D3D]' : 'bg-[#424242]'}>
                    {parseRow(row).map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-[#D0D0D0] border-b border-[#484848] align-top break-words">
                        {parseInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={key++} className="border-l-2 border-[#F4821E] pl-3 my-2 text-[#888888] text-sm italic">
          {parseInline(line.slice(2))}
        </blockquote>
      )
      i++; continue
    }

    // Empty line — skip
    if (line.trim() === '') {
      i++; continue
    }

    // Plain paragraph
    elements.push(
      <p key={key++} className="text-sm text-[#D0D0D0] leading-relaxed my-1">
        {parseInline(line)}
      </p>
    )
    i++
  }

  return <div className="space-y-0.5">{elements}</div>
}
