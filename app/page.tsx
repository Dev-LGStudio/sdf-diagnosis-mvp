'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const MODELS = [
  {
    brand: 'DEUTZ-FAHR',
    familyCode: '239',
    familyDesc: '6115-6125-6135 PS T5F',
    modelCode: 'LW1',
    modelDesc: '6125 C',
  },
]

export default function HomePage() {
  const router = useRouter()
  const [selected, setSelected] = useState(MODELS[0].modelCode)

  const model = MODELS.find((m) => m.modelCode === selected) ?? MODELS[0]

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    router.push(`/diagnose?brand=${encodeURIComponent(model.brand)}&model=${encodeURIComponent(model.modelCode)}`)
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-md w-full max-w-md p-8">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-green-600 mb-1">
            SDF Diagnosis
          </p>
          <h1 className="text-2xl font-bold text-gray-900">
            Assistente diagnosi
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Seleziona il modello per iniziare la diagnosi
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="model"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Modello macchina
            </label>
            <select
              id="model"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            >
              {MODELS.map((m) => (
                <option key={m.modelCode} value={m.modelCode}>
                  {m.brand} {m.modelDesc} — {m.familyDesc}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-500 space-y-1">
            <div><span className="font-medium text-gray-700">Brand:</span> {model.brand}</div>
            <div><span className="font-medium text-gray-700">Famiglia:</span> {model.familyCode} — {model.familyDesc}</div>
            <div><span className="font-medium text-gray-700">Modello:</span> {model.modelCode} — {model.modelDesc}</div>
          </div>

          <button
            type="submit"
            className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
          >
            Inizia diagnosi →
          </button>
        </form>
      </div>
    </main>
  )
}
