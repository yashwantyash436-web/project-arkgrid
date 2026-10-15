import { useCallback, useEffect, useState } from 'react'
import { arkgridApi, ApiError } from '../api/client'
import type { SourceStatus } from '../api/types'

function describeProduct(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'Name' in value && typeof value.Name === 'string') {
    return value.Name
  }
  return 'Product metadata returned'
}

export function SourceStatusPanel({ compact = false }: { compact?: boolean }) {
  const [sources, setSources] = useState<SourceStatus[]>([])
  const [checkedAt, setCheckedAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await arkgridApi.sourceStatuses()
      setSources(result.items)
      setCheckedAt(result.checked_at)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Source status could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void Promise.resolve().then(refresh) }, [refresh])

  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">External source status</h2>
          <p className="mt-1 text-sm text-slate-600">Reachability is not proof that a source provides a current hazard product.</p>
          {checkedAt && <p className="mt-1 text-xs text-slate-500">Checked {new Date(checkedAt).toLocaleString()}</p>}
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="min-h-10 rounded-lg border border-slate-400 px-3 text-sm font-semibold disabled:opacity-60">
          {loading ? 'Checking…' : 'Check sources'}
        </button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      {!error && !loading && sources.length === 0 && <p className="text-sm text-slate-600">No source status is available.</p>}
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        {sources.map(source => (
          <li key={source.name} className="min-w-0 rounded-lg border border-slate-200 p-4">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <a href={source.url} target="_blank" rel="noreferrer" className="font-semibold text-slate-950 underline">{source.name}</a>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${source.data_available ? 'bg-emerald-100 text-emerald-900' : source.page_reachable ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-900'}`}>
                {source.data_available ? 'Data connected' : source.page_reachable ? 'Page/metadata only' : 'Unavailable'}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-600">HTTP {source.http_status ?? 'not reached'} · {source.integration_status}{source.requires_credentials ? ' · credentials or authorized access may be required' : ''}</p>
            <p className="mt-2 text-sm text-slate-700">{source.limitations}</p>
            {source.last_successful_retrieval && <p className="mt-1 text-xs text-slate-500">Last successful retrieval: {new Date(source.last_successful_retrieval).toLocaleString()}</p>}
            {!compact && source.name === 'Copernicus Data Space' && source.metadata_available && (
              <p className="mt-2 break-words rounded bg-slate-50 p-2 text-xs text-slate-700">
                Latest catalogue result: {describeProduct(source.data_returned)}. This is metadata only, not a rendered satellite image.
              </p>
            )}
            {source.error && <p className="mt-2 text-xs text-red-800">{source.error}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}
