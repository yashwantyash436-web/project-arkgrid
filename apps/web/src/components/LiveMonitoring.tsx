import { useCallback, useEffect, useMemo, useState } from 'react'
import { arkgridApi, ApiError } from '../api/client'
import type { EarthquakeResponse } from '../api/types'
import { MapView } from './MapView'
import { incidents as demoIncidents } from '../data/demoData'

export function LiveMonitoring({ center, compact = false }: { center: [number, number]; compact?: boolean }) {
  const [data, setData] = useState<EarthquakeResponse | null>(null)
  const [now, setNow] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showEarthquakes, setShowEarthquakes] = useState(true)
  const [showDemoIncidents, setShowDemoIncidents] = useState(false)
  const [minimumMagnitude, setMinimumMagnitude] = useState('0')
  const [timeWindowHours, setTimeWindowHours] = useState('24')
  const [placeFilter, setPlaceFilter] = useState('')
  const [selectedEarthquakeId, setSelectedEarthquakeId] = useState('')
  const [selectedDemoIncidentId, setSelectedDemoIncidentId] = useState('')
  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await arkgridApi.earthquakes(-2)
      setData(response)
      setNow(Date.now())
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'USGS observations could not be loaded.'
      setError(message)
      setData(current => current ? { ...current, stale: true, error: message } : current)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void Promise.resolve().then(refresh) }, [refresh])

  const events = useMemo(() => {
    if (!data) return []
    const cutoff = now - Number(timeWindowHours) * 60 * 60 * 1000
    return data.items.filter(event =>
      (event.magnitude === null || event.magnitude >= Number(minimumMagnitude)) &&
      new Date(event.time).getTime() >= cutoff &&
      event.place.toLowerCase().includes(placeFilter.trim().toLowerCase()),
    )
  }, [data, minimumMagnitude, now, placeFilter, timeWindowHours])
  const selectedEarthquake = events.find(event => event.id === selectedEarthquakeId) ?? null
  const selectedDemoIncident = demoIncidents.find(incident => incident.id === selectedDemoIncidentId) ?? null

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-violet-200 bg-violet-50 p-5" aria-labelledby="usgs-live-feed">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="usgs-live-feed" className="text-lg font-bold text-violet-950">{compact ? 'Live earthquake map preview' : 'Recent USGS earthquake observations'}</h2>
            <p className="mt-1 text-sm text-violet-900">Official USGS all-day GeoJSON feed, fetched by the ArkGrid backend. Observations do not predict earthquakes.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="min-h-11 rounded-lg border border-violet-400 bg-white px-4 text-sm font-semibold text-violet-950 disabled:opacity-60">
            {loading ? 'Refreshing…' : 'Refresh observations'}
          </button>
        </div>
        {data?.fetched_at && <p className="mt-3 text-xs text-violet-900">Last successful backend retrieval: {new Date(data.fetched_at).toLocaleString()}{data.stale ? ' · cached data is stale' : ''}</p>}
        {data?.stale && data.error && <p role="status" className="mt-2 text-sm text-amber-900">The latest request failed; showing the last successful USGS response. {data.error}</p>}
      </section>

      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {loading && !data && <p role="status" className="rounded-lg bg-white p-4 text-sm text-slate-700">Loading earthquake observations from the backend…</p>}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Earthquake map">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={showEarthquakes} onChange={event => {
            setShowEarthquakes(event.target.checked)
            if (!event.target.checked) setSelectedEarthquakeId('')
          }} /> USGS observations ({showEarthquakes ? events.length : 0} visible)</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={showDemoIncidents} onChange={event => {
            setShowDemoIncidents(event.target.checked)
            if (!event.target.checked) setSelectedDemoIncidentId('')
          }} /> Fictional demo incidents ({showDemoIncidents ? demoIncidents.length : 0} visible)</label>
        </div>
        <div className={compact ? 'h-[280px]' : 'h-[340px]'}>
          <MapView center={center} zoom={5} markers={showDemoIncidents} earthquakes={events} showEarthquakes={showEarthquakes}
            selectedEarthquakeId={selectedEarthquakeId}
            onEarthquakeSelect={event => setSelectedEarthquakeId(event.id)}
            selectedDemoIncidentId={selectedDemoIncidentId}
            onDemoIncidentSelect={incident => setSelectedDemoIncidentId(incident.id)}
            onAreaSelect={() => undefined} />
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-700" aria-label="Map legend">
          <span><strong className="text-violet-800">● USGS</strong> external observations</span>
          <span><strong className="text-orange-800">● Orange/red</strong> fictional demo fixtures</span>
          <span>Citizen reports are not displayed in this map layer.</span>
        </div>
        <p className="text-xs text-slate-600">Map tiles: OpenStreetMap contributors. Tile label language is controlled by the map data/style and may not be English; ArkGrid cannot translate text baked into raster tiles. Event details and controls are English. Basemap tiles are not cached offline.</p>
        {selectedEarthquake && (
          <article className="rounded-lg border border-violet-200 bg-violet-50 p-4" aria-label="Selected USGS event details">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-bold text-violet-950">Selected USGS observation · M{selectedEarthquake.magnitude ?? 'unknown'}</h3>
                <p className="mt-1 text-sm text-violet-950">{selectedEarthquake.place}</p>
                <p className="mt-1 text-xs text-violet-900">Observed {new Date(selectedEarthquake.time).toLocaleString()} · {selectedEarthquake.latitude.toFixed(4)}, {selectedEarthquake.longitude.toFixed(4)} · Depth {selectedEarthquake.depth_km ?? 'unknown'} km</p>
                <a href={selectedEarthquake.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold underline">Open original USGS event</a>
              </div>
              <button type="button" onClick={() => setSelectedEarthquakeId('')} className="min-h-10 rounded border border-violet-400 bg-white px-3 text-sm font-semibold">Clear selection</button>
            </div>
          </article>
        )}
        {selectedDemoIncident && (
          <article className="rounded-lg border border-amber-300 bg-amber-50 p-4" aria-label="Selected demo incident details">
            <h3 className="font-bold text-amber-950">Demo fixture · {selectedDemoIncident.title}</h3>
            <p className="mt-1 text-sm text-amber-950">{selectedDemoIncident.id} · {selectedDemoIncident.location} · {selectedDemoIncident.severity}</p>
            <p className="mt-1 text-sm text-amber-950">{selectedDemoIncident.description}</p>
            <button type="button" onClick={() => setSelectedDemoIncidentId('')} className="mt-2 min-h-10 rounded border border-amber-500 bg-white px-3 text-sm font-semibold">Clear selection</button>
          </article>
        )}
      </section>

      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">Minimum magnitude
          <select value={minimumMagnitude} onChange={event => setMinimumMagnitude(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3">
            {['0', '2', '3', '4', '5'].map(value => <option key={value} value={value}>M{value}+</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Time window
          <select value={timeWindowHours} onChange={event => setTimeWindowHours(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3">
            <option value="1">Past hour</option><option value="6">Past 6 hours</option><option value="24">Past 24 hours</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Place contains
          <input value={placeFilter} onChange={event => setPlaceFilter(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3" placeholder="Optional place filter" />
        </label>
      </section>

      {!loading && !error && data && events.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700">No USGS observations match the current filters. No live events are fabricated.</p>
      )}

      {events.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white px-5">
          {showEarthquakes && events.slice(0, compact ? 5 : undefined).map(event => (
            <li key={event.id} className="py-4">
              <button type="button" aria-pressed={selectedEarthquakeId === event.id}
                onClick={() => setSelectedEarthquakeId(event.id)}
                className={`w-full rounded-lg p-3 text-left ${selectedEarthquakeId === event.id ? 'bg-violet-50 ring-2 ring-violet-500' : 'hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-700'}`}>
                <span className="block font-semibold text-slate-950">M{event.magnitude ?? 'unknown'} · {event.place}</span>
                <span className="mt-1 block text-xs text-slate-600">{new Date(event.time).toLocaleString()} · {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}{event.depth_km !== null ? ` · ${event.depth_km} km depth` : ''}</span>
                <span className="mt-1 block text-xs font-semibold text-violet-800">Select to inspect the corresponding map marker · External observation · USGS</span>
              </button>
              <a href={event.url} target="_blank" rel="noreferrer" className="ml-3 mt-2 inline-block text-sm font-semibold text-violet-800 underline">USGS event details</a>
            </li>
          ))}
          {compact && showEarthquakes && events.length > 5 && (
            <li className="py-3 text-sm text-slate-600">Showing the first 5 matching events in the preview; open Live monitoring for the complete filtered list.</li>
          )}
        </ul>
      )}
    </div>
  )
}
