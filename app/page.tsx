'use client'

import { useState, useEffect, useRef } from 'react'
import MarkdownRenderer from '@/components/MarkdownRenderer'

type Model = {
  brand:       string
  model:       string
  model_desc:  string | null
  family_desc: string | null
}

function shortDesc(m: Model): string {
  return (m.model_desc ?? '').split('->')[0].trim() || m.model
}

function modelKey(m: Model) {
  return `${m.brand}|${m.model}`
}

export default function HomePage() {
  const [models,   setModels]   = useState<Model[]>([])
  const [selected, setSelected] = useState<Model | null>(null)
  const [query,    setQuery]    = useState('')
  const [result,   setResult]   = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then((data: Model[]) => {
        setModels(data)
        if (data.length > 0) setSelected(data[0])
      })
      .catch(err => setError(String(err)))
  }, [])

  async function runDiagnosis(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!selected || !query.trim()) return

    setResult('')
    setError('')
    setLoading(true)
    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem:   query,
          brand:     selected.brand,
          modelCode: selected.model,
        }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) throw new Error(`Server error: ${res.status}`)

      const reader  = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('Stream not available')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setResult(prev => prev + decoder.decode(value, { stream: true }))
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  function stopDiagnosis() {
    abortRef.current?.abort()
    setLoading(false)
  }

  const canSubmit = !!selected && query.trim().length > 0 && !loading

  return (
    <div className="flex h-screen bg-[#3D3D3D] text-[#F0F0F0] overflow-hidden">

      {/* ── SIDEBAR ─────────────────────────────────────────────── */}
      <aside className="w-[280px] flex-shrink-0 bg-[#484848] border-r border-[#555555] flex flex-col">

        {/* Logo + title */}
        <div className="p-5 border-b border-[#555555]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#F4821E] rounded flex items-center justify-center flex-shrink-0">
              <span className="text-white font-black text-[10px] tracking-tight">SDF</span>
            </div>
            <h1 className="text-sm font-bold text-[#F0F0F0] tracking-wide leading-tight">
              Diagnostic Assistant
            </h1>
          </div>
        </div>

        {/* Model selector */}
        <div className="p-5 flex-1 overflow-y-auto">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#888888] mb-2">
            Select Model
          </label>

          <select
            value={selected ? modelKey(selected) : ''}
            onChange={e => {
              const [brand, model] = e.target.value.split('|')
              const m = models.find(x => x.brand === brand && x.model === model)
              if (m) setSelected(m)
            }}
            className="w-full bg-[#3D3D3D] border border-[#555555] text-[#F0F0F0] text-sm rounded px-3 py-2 focus:outline-none focus:border-[#F4821E] focus:ring-1 focus:ring-[#F4821E] cursor-pointer appearance-none"
          >
            {models.length === 0 && (
              <option value="">Loading models…</option>
            )}
            {models.map(m => (
              <option key={modelKey(m)} value={modelKey(m)}>
                {m.brand} {m.model} — {shortDesc(m)}
              </option>
            ))}
          </select>

          {selected?.family_desc && (
            <div className="mt-3 p-3 bg-[#3D3D3D] rounded border border-[#555555] space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#555555]">Family</div>
              <div className="text-xs text-[#888888] leading-snug">{selected.family_desc}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-[#555555]">
          <div className="text-[11px] text-[#444444]">v0.1.0 — © SDF Group</div>
        </div>
      </aside>

      {/* ── MAIN AREA ────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Header bar */}
        <div className="px-6 py-3.5 border-b border-[#555555] flex-shrink-0 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#F0F0F0]">
              Diagnostic Assistant
            </h2>
            {selected && (
              <p className="text-[11px] text-[#888888] mt-0.5">
                {selected.brand} · {selected.model} · {shortDesc(selected)}
              </p>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-3xl mx-auto space-y-5">

            {/* Query form */}
            <form onSubmit={runDiagnosis} className="space-y-3">
              <textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                rows={5}
                placeholder="Describe the symptom or enter an error code (e.g. eTCV_7602178)…"
                className="w-full bg-[#484848] border border-[#555555] text-[#F0F0F0] text-sm rounded px-4 py-3 placeholder-[#444444] focus:outline-none focus:border-[#F4821E] focus:ring-1 focus:ring-[#F4821E] resize-y min-h-[120px] leading-relaxed"
              />

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="flex items-center gap-2 bg-[#F4821E] hover:bg-[#e07018] disabled:bg-[#3a3a3a] disabled:text-[#444444] disabled:cursor-not-allowed text-white font-bold rounded px-5 py-2.5 text-sm transition-colors"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Analyzing…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd" />
                      </svg>
                      Run Diagnosis
                    </>
                  )}
                </button>

                {loading && (
                  <button
                    type="button"
                    onClick={stopDiagnosis}
                    className="px-4 py-2.5 text-sm font-semibold text-[#F4821E] border border-[#F4821E] rounded hover:bg-[#F4821E]/10 transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>
            </form>

            {/* Error */}
            {error && (
              <div className="bg-red-950/40 border border-red-800/60 rounded p-4 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Results */}
            {result && (
              <div className="bg-[#484848] border border-[#555555] rounded-lg p-5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#AAAAAA] mb-4 pb-3 border-b border-[#555555]">
                  Diagnosis Result — {selected?.brand} {selected?.model}
                </div>
                <MarkdownRenderer content={result} />
                {loading && (
                  <span className="inline-block w-1.5 h-4 bg-[#F4821E] ml-1 animate-pulse rounded-sm" />
                )}
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  )
}
