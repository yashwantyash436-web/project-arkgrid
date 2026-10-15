import { useCallback, useEffect, useState } from 'react'
import { arkgridApi, ApiError } from '../api/client'
import type { EarthquakeResponse, Incident } from '../api/types'

type LoadState<T> = {
  value: T | null
  error: string
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{detail}</p>
    </div>
  )
}

export function DashboardSummary({ pendingReports }: { pendingReports: number }) {
  const [incidents, setIncidents] = useState<LoadState<Incident[]>>({ value: null, error: '' })
  const [earthquakes, setEarthquakes] = useState<LoadState<EarthquakeResponse>>({ value: null, error: '' })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [incidentResult, earthquakeResult] = await Promise.allSettled([
      arkgridApi.incidents(),
      arkgridApi.earthquakes(-2),
    ])
    if (incidentResult.status === 'fulfilled') {
      setIncidents({ value: incidentResult.value.items, error: '' })
    } else {
      setIncidents({ value: null, error: errorMessage(incidentResult.reason, 'Incident summary is unavailable.') })
    }
    if (earthquakeResult.status === 'fulfilled') {
      setEarthquakes({ value: earthquakeResult.value, error: '' })
    } else {
      setEarthquakes({ value: null, error: errorMessage(earthquakeResult.reason, 'USGS freshness is unavailable.') })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void Promise.resolve().then(refresh)
  }, [refresh])

  const incidentItems = incidents.value
  const active = incidentItems?.filter(item => !['resolved', 'closed'].includes(item.status))
  const highPriority = active?.filter(item => item.priority.score >= 50)
  const earthquakeCount = earthquakes.value
    ? `${earthquakes.value.items.length}${earthquakes.value.stale ? ' · stale feed' : ''}`
    : 'Unavailable'
  const earthquakeDetail = earthquakes.error
    ? 'USGS feed unavailable'
    : earthquakes.value?.fetched_at
      ? `USGS observations · retrieved ${new Date(earthquakes.value.fetched_at).toLocaleString()}`
      : 'USGS retrieval time unavailable'

  return (
    <section className="space-y-3" aria-labelledby="dashboard-summary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="dashboard-summary" className="text-sm font-semibold text-slate-900">Situation summary</h2>
          <p className="mt-1 text-xs text-slate-600">Live API counts and reports saved on this device; reports are not verified or dispatched.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}
          className="min-h-10 rounded-lg border border-slate-400 bg-white px-3 text-sm font-semibold disabled:opacity-60">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Open incidents" value={active ? String(active.length) : 'Unavailable'}
          detail={incidentItems ? 'Persisted API reports not resolved or closed' : incidents.error ? 'API reports unavailable' : 'Loading API data'} />
        <Metric label="High-priority incidents" value={highPriority ? String(highPriority.length) : 'Unavailable'}
          detail={incidentItems ? 'Rule score ≥50/100 · review aid only' : incidents.error ? 'API reports unavailable' : 'Loading API data'} />
        <Metric label="Earthquake observations" value={earthquakeCount}
          detail={earthquakeDetail} />
        <Metric label="Pending local reports" value={String(pendingReports)}
          detail="Saved on this device · not yet synchronized" />
      </div>
    </section>
  )
}
