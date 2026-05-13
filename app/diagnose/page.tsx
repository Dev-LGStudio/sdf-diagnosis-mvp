'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useState, useRef, Suspense } from 'react'

function DiagnosePage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const brand = searchParams.get('brand') ?? ''
  const modelCode = searchParams.get('model') ?? ''

  const [problem, setProblem] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  async function handleAnalyze(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!problem.trim()) return

    setResult('')
    setError('')
    setLoading(true)

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem, brand, modelCode }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        throw new Error(`Errore server: ${res.status}`)
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('Stream non disponibile')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setResult((prev) => prev + decoder.decode(value, { stream: true }))
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">

        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Indietro
          </button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-green-600">
              SDF Diagnosis
            </p>
            <h1 className="text-xl font-bold text-gray-900">
              {brand} — {modelCode}
            </h1>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-md p-6">
          <form onSubmit={handleAnalyze} className="space-y-4">
            <div>
              <label
                htmlFor="problem"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Descrivi il problema o il sintomo
              </label>
              <textarea
                id="problem"
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                rows={4}
                placeholder="Es: Il motore non si avvia, la spia dell'olio è accesa, perdita di potenza in salita..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading || !problem.trim()}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
              >
                {loading ? 'Analisi in corso...' : 'Analizza'}
              </button>
              {loading && (
                <button
                  type="button"
                  onClick={handleStop}
                  className="px-4 py-2.5 text-sm font-semibold text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Stop
                </button>
              )}
            </div>
          </form>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {result && (
          <div className="bg-white rounded-2xl shadow-md p-6">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-400 mb-4">
              Risultato diagnosi
            </h2>
            <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
              {result}
              {loading && (
                <span className="inline-block w-2 h-4 bg-green-500 ml-0.5 animate-pulse" />
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

export default function DiagnosePageWrapper() {
  return (
    <Suspense>
      <DiagnosePage />
    </Suspense>
  )
}
