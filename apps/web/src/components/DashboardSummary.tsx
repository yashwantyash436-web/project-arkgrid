import { useCallback, useEffect, useState } from 'react'
import { arkgridApi, ApiError } from '../api/client'
import type { EarthquakeResponse, Incident, Resource, SourceStatus } from '../api/types'

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
  const [resources, setResources] = useState<LoadState<Resource[]>>({ value: null, error: '' })
  const [earthquakes, setEarthquakes] = useState<LoadState<EarthquakeResponse>>({ value: null, error: '' })
  const [sources, setSources] = useState<LoadState<SourceStatus[]>>({ value: null, error: '' })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [incidentResult, resourceResult, earthquakeResult, sourceResult] = await Promise.allSettled([
      arkgridApi.incidents(),
      arkgridApi.resources(),
      arkgridApi.earthquakes(-2),
      arkgridApi.sourceStatuses(),
    ])
    if (incidentResult.status === 'fulfilled') {
      setIncidents({ value: incidentResult.value.items, error: '' })
    } else {
      setIncidents({ value: null, error: errorMessage(incidentResult.reason, 'Incident summary is unavailable.') })
    }
    if (resourceResult.status === 'fulfilled') {
      setResources({ value: resourceResult.value.items, error: '' })
    } else {
      setResources({ value: null, error: errorMessage(resourceResult.reason, 'Resource summary is unavailable.') })
    }
    if (earthquakeResult.status === 'fulfilled') {
      setEarthquakes({ value: earthquakeResult.value, error: '' })
    } else {
      setEarthquakes({ value: null, error: errorMessage(earthquakeResult.reason, 'USGS freshness is unavailable.') })
    }
    if (sourceResult.status === 'fulfilled') {
      setSources({ value: sourceResult.value.items, error: '' })
    } else {
      setSources({ value: null, error: errorMessage(sourceResult.reason, 'External source status is unavailable.') })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void Promise.resolve().then(refresh)
  }, [refresh])

  const incidentItems = incidents.value
  const resourceItems = resources.value
  const active = incidentItems?.filter(item => !['resolved', 'closed'].includes(item.status))
  const unreviewed = incidentItems?.filter(item => item.status === 'new')
  const highPriority = incidentItems?.filter(item => item.priority.score >= 50)
  const acknowledgedReports = incidentItems?.filter(item => item.data_class === 'citizen_report')
  const availableResources = resourceItems?.filter(item => item.is_simulated && item.available)
  const activeDataSources = sources.value?.filter(source => source.data_available) ?? []
  const metadataSources = sources.value?.filter(source => !source.data_available && source.metadata_available) ?? []
  const sourceSummary = sources.error || (sources.value
    ? `${activeDataSources.length} hazard feed(s) report data; ${metadataSources.length} source(s) metadata-only`
    : 'Loading API source status')
  const earthquakeStatus = earthquakes.error
    ? `Unavailable · ${earthquakes.error}`
    : earthquakes.value?.stale
      ? `Stale · last retrieved ${earthquakes.value.fetched_at ? new Date(earthquakes.value.fetched_at).toLocaleString() : 'unknown'}`
      : earthquakes.value?.fetched_at
        ? `Last retrieved ${new Date(earthquakes.value.fetched_at).toLocaleString()}`
        : 'Retrieval time unavailable'

  return (
    <section className="space-y-3" aria-labelledby="dashboard-summary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="dashboard-summary" className="text-sm font-semibold text-slate-900">Current demo system summary</h2>
          <p className="mt-1 text-xs text-slate-600">Counts are fetched from the API or this device; backend acknowledgement is not emergency-service delivery.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}
          className="min-h-10 rounded-lg border border-slate-400 bg-white px-3 text-sm font-semibold disabled:opacity-60">
          {loading ? 'Refreshing…' : 'Refresh summary'}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active incidents" value={active ? String(active.length) : 'Unavailable'}
          detail={incidentItems ? `${incidentItems.length} persisted API record(s)` : incidents.error || 'Loading API data'} />
        <Metric label="New / unreviewed" value={unreviewed ? String(unreviewed.length) : 'Unavailable'}
          detail={incidentItems ? 'Status is “new”' : incidents.error || 'Loading API data'} />
        <Metric label="High-priority rules scores" value={highPriority ? String(highPriority.length) : 'Unavailable'}
          detail={incidentItems ? 'Score ≥50/100; review aid only' : incidents.error || 'Loading API data'} />
        <Metric label="Backend-acknowledged citizen reports" value={acknowledgedReports ? String(acknowledgedReports.length) : 'Unavailable'}
          detail={incidentItems ? 'Persisted here; reports remain unverified' : incidents.error || 'Loading API data'} />
        <Metric label="Pending device reports" value={String(pendingReports)}
          detail="Stored locally; not yet uploaded" />
        <Metric label="Available demo resources" value={availableResources ? String(availableResources.length) : 'Unavailable'}
          detail={resourceItems ? `${resourceItems.length} fictional resource(s) in API` : resources.error || 'Loading API data'} />
        <Metric label="USGS feed freshness" value={earthquakes.value && !earthquakes.error ? (earthquakes.value.stale ? 'Stale' : 'Retrieved') : 'Unavailable'}
          detail={earthquakeStatus} />
        <Metric label="External source status" value={sources.value ? `${activeDataSources.length} data feed(s)` : 'Unavailable'}
          detail={sourceSummary} />
        <Metric label="Confirmed responder dispatches" value="Not available"
          detail="ArkGrid does not connect to or dispatch real responders" />
      </div>
    </section>
  )
}
