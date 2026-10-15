import { useCallback, useEffect, useMemo, useState } from 'react'
import { arkgridApi, ApiError } from '../api/client'
import type { Earthquake, EarthquakeResponse, Incident } from '../api/types'
import { MapView } from './MapView'
import { emptyHazardLayers } from './mapTypes'
import type { HazardLayers, MapFeature } from './mapTypes'
import { incidents as demoIncidents } from '../data/demoData'
import { isInSeismicRegion, seismicRegions } from '../data/seismicRegions'

export function LiveMonitoring({
  center,
  compact = false,
  onOpenAreaMap,
}: {
  center: [number, number]
  compact?: boolean
  onOpenAreaMap?: () => void
}) {
  const [data, setData] = useState<EarthquakeResponse | null>(null)
  const [now, setNow] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showEarthquakes, setShowEarthquakes] = useState(true)
  const [showDemoIncidents, setShowDemoIncidents] = useState(false)
  const [hazardLayers, setHazardLayers] = useState(emptyHazardLayers)
  const [reportedIncidents, setReportedIncidents] = useState<Incident[] | null>(null)
  const [incidentError, setIncidentError] = useState('')
  const [globalOverview, setGlobalOverview] = useState(true)
  const [selectedRegionId, setSelectedRegionId] = useState('global')
  const [showRegionBounds, setShowRegionBounds] = useState(false)
  const [minimumMagnitude, setMinimumMagnitude] = useState('0')
  const [timeWindowHours, setTimeWindowHours] = useState('24')
  const [placeFilter, setPlaceFilter] = useState('')
  const [selectedEarthquakeId, setSelectedEarthquakeId] = useState('')
  const [selectedDemoIncidentId, setSelectedDemoIncidentId] = useState('')
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null)
  const refresh = useCallback(async (force = false) => {
    setLoading(true)
    setError('')
    try {
      const response = force ? await arkgridApi.earthquakes(-2, true) : await arkgridApi.earthquakes(-2)
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

  useEffect(() => { void Promise.resolve().then(() => refresh()) }, [refresh])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => arkgridApi.incidents())
      .then(result => {
        if (active) {
          setReportedIncidents(result.items)
          setIncidentError('')
        }
      })
      .catch(cause => {
        if (active) setIncidentError(cause instanceof ApiError ? cause.message : 'Citizen reports could not be loaded.')
      })
    return () => { active = false }
  }, [])

  const selectedRegion = seismicRegions.find(region => region.id === selectedRegionId) ?? null
  const regionEvents = useMemo(() => {
    if (!data) return []
    const cutoff = now - Number(timeWindowHours) * 60 * 60 * 1000
    return data.items.filter(event => new Date(event.time).getTime() >= cutoff &&
      (!selectedRegion || isInSeismicRegion(event.latitude, event.longitude, selectedRegion)))
  }, [data, now, selectedRegion, timeWindowHours])
  const events = useMemo(() => regionEvents.filter(event =>
    event.magnitude !== null && event.magnitude >= Number(minimumMagnitude) &&
    event.place.toLowerCase().includes(placeFilter.trim().toLowerCase()),
  ), [minimumMagnitude, placeFilter, regionEvents])
  const mostRecentRegionalEvent = useMemo(
    () => [...regionEvents].sort((left, right) => Date.parse(right.time) - Date.parse(left.time))[0] ?? null,
    [regionEvents],
  )
  const strongestRegionalEvent = useMemo(
    () => regionEvents.reduce<Earthquake | null>(
      (strongest, event) => event.magnitude !== null &&
        (strongest?.magnitude === null || strongest?.magnitude === undefined || event.magnitude > strongest.magnitude)
        ? event
        : strongest,
      null,
    ),
    [regionEvents],
  )
  const importantIncidents = useMemo(
    () => (reportedIncidents ?? [])
      .filter(incident => !['resolved', 'closed'].includes(incident.status))
      .sort((left, right) => right.priority.score - left.priority.score ||
        right.created_at.localeCompare(left.created_at))
      .slice(0, 5),
    [reportedIncidents],
  )
  const selectedEarthquake = events.find(event => event.id === selectedEarthquakeId) ?? null
  const selectedDemoIncident = demoIncidents.find(incident => incident.id === selectedDemoIncidentId) ?? null
  const toggleHazardLayer = (layer: keyof HazardLayers) => {
    setHazardLayers(current => ({ ...current, [layer]: !current[layer] }))
    setSelectedFeature(null)
    setSelectedIncident(null)
  }

  return (
    <div className="min-w-0 space-y-5">
      <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5" aria-labelledby="usgs-live-feed">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="usgs-live-feed" className="text-lg font-bold text-cyan-950">{compact ? 'Live map' : 'Recent USGS earthquake observations'}</h2>
            <p className="mt-1 text-sm text-cyan-950">{compact
              ? 'USGS observations and reported incidents. The map is illustrative and does not predict hazards.'
              : 'Official USGS all-day GeoJSON feed, fetched by the ArkGrid backend. Observations do not predict earthquakes.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onOpenAreaMap && <button type="button" onClick={onOpenAreaMap} className="min-h-11 rounded-lg border border-cyan-700 bg-white px-3 text-sm font-semibold text-cyan-950">Area map</button>}
            <button type="button" onClick={() => void refresh(true)} disabled={loading} className="min-h-11 rounded-lg border border-cyan-700 bg-white px-4 text-sm font-semibold text-cyan-950 disabled:opacity-60">
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {data?.fetched_at && <p className="mt-3 text-xs text-cyan-950">Last successful backend retrieval: {new Date(data.fetched_at).toLocaleString()}{data.stale ? ' · cached data is stale' : ''}</p>}
        {data?.stale && data.error && <p role="status" className="mt-2 text-sm text-amber-900">The latest request failed; showing the last successful USGS response. {data.error}</p>}
      </section>

      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {loading && !data && <p role="status" className="rounded-lg bg-white p-4 text-sm text-slate-700">Loading earthquake observations from the backend…</p>}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Earthquake map">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {!compact && <div className="flex gap-2" role="group" aria-label="Map extent">
            <button type="button" aria-pressed={globalOverview} onClick={() => {
              setGlobalOverview(true)
              setSelectedRegionId('global')
            }}
              className={`min-h-10 rounded-lg border px-3 font-semibold ${globalOverview ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-400 bg-white text-slate-900'}`}>
              Global overview
            </button>
            <button type="button" aria-pressed={!globalOverview} onClick={() => {
              setGlobalOverview(false)
              if (!selectedRegionId || selectedRegionId === 'global') setSelectedRegionId('nepal')
            }}
              className={`min-h-10 rounded-lg border px-3 font-semibold ${!globalOverview ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-400 bg-white text-slate-900'}`}>
              Scenario region
            </button>
          </div>}
          {!compact && <label className="flex min-h-11 items-center gap-2">Monitored region
            <select aria-label="Monitored seismic region" value={selectedRegionId} onChange={event => {
              setSelectedRegionId(event.target.value)
              setGlobalOverview(event.target.value === 'global')
              setSelectedEarthquakeId('')
            }} className="min-h-11 max-w-64 rounded-lg border border-slate-300 bg-white px-3">
              <option value="global">Global observations</option>
              {seismicRegions.map(region => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </label>}
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={showEarthquakes} onChange={event => {
            setShowEarthquakes(event.target.checked)
            if (!event.target.checked) setSelectedEarthquakeId('')
          }} /> USGS observations ({!data ? loading ? 'loading' : 'unavailable' : showEarthquakes ? events.length : 0} visible)</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={showDemoIncidents} onChange={event => {
            setShowDemoIncidents(event.target.checked)
            if (!event.target.checked) setSelectedDemoIncidentId('')
          }} /> Fictional demo incidents ({showDemoIncidents ? demoIncidents.length : 0} visible)</label>
        </div>
        <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <summary className="min-h-10 cursor-pointer content-center text-sm font-bold text-slate-900">Optional hazard and information layers</summary>
          <fieldset className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Hazard map layers">
            <legend className="sr-only">Choose map layers</legend>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={hazardLayers.citizenReports} onChange={() => toggleHazardLayer('citizenReports')} />Citizen reports ({reportedIncidents?.filter(item => item.latitude !== null && item.longitude !== null).length ?? '—'} geolocated)</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={hazardLayers.floodRisk} onChange={() => toggleHazardLayer('floodRisk')} />Simulated flood-risk cells</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={hazardLayers.floodPath} onChange={() => toggleHazardLayer('floodPath')} />Simulated flood corridor</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={hazardLayers.landslideZones} onChange={() => toggleHazardLayer('landslideZones')} />Simulated landslide zones</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={hazardLayers.affectedPopulation} onChange={() => toggleHazardLayer('affectedPopulation')} />Synthetic settlements and population</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={hazardLayers.lowerRiskLocations} onChange={() => toggleHazardLayer('lowerRiskLocations')} />Potentially lower-risk demo locations</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={hazardLayers.fictionalResources} onChange={() => toggleHazardLayer('fictionalResources')} />Fictional demo resources</label>
            {!compact && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showRegionBounds} onChange={event => setShowRegionBounds(event.target.checked)} />Show approximate monitored-region bounds</label>}
          </fieldset>
          {hazardLayers.citizenReports && incidentError && <p role="alert" className="mt-2 rounded bg-red-50 p-3 text-sm text-red-900">Citizen reports unavailable: {incidentError}. No incident markers were fabricated.</p>}
          {hazardLayers.citizenReports && reportedIncidents && reportedIncidents.every(item => item.latitude === null || item.longitude === null) && (
            <p className="mt-2 text-sm text-slate-700">No API reports have map coordinates. Reports without a location are not plotted.</p>
          )}
        </details>
        <div className={compact ? 'grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]' : 'space-y-3'}>
          <div className={compact ? 'h-[420px] min-w-0 sm:h-[480px]' : 'h-[340px]'}>
            <MapView center={globalOverview ? [18, 0] : selectedRegion?.center ?? center}
              zoom={globalOverview ? 2 : selectedRegion?.zoom ?? 5}
              markers={showDemoIncidents} earthquakes={events} showEarthquakes={showEarthquakes}
              selectedSeismicRegion={!globalOverview ? selectedRegion : null}
              showRegionBounds={showRegionBounds}
              selectedEarthquakeId={selectedEarthquakeId}
              onEarthquakeSelect={event => {
                setSelectedEarthquakeId(event.id)
                setSelectedIncident(null)
                setSelectedFeature(null)
              }}
              selectedDemoIncidentId={selectedDemoIncidentId}
              onDemoIncidentSelect={incident => {
                setSelectedDemoIncidentId(incident.id)
                setSelectedFeature({ id: incident.id, label: `Demo fixture · ${incident.title}`, description: incident.description, latitude: incident.lat, longitude: incident.lng })
              }}
              incidentReports={reportedIncidents ?? []}
              layers={hazardLayers}
              selectedFeatureId={selectedFeature?.id ?? selectedIncident?.id}
              onIncidentSelect={incident => {
                setSelectedIncident(incident)
                setSelectedEarthquakeId('')
                setSelectedFeature(null)
              }}
              onFeatureSelect={feature => {
                setSelectedFeature(feature)
                setSelectedIncident(null)
                setSelectedEarthquakeId('')
              }}
              onAreaSelect={() => undefined} />
          </div>
          {compact && (
            <aside className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4" aria-label="Important incidents and selected map details">
              <h3 className="text-sm font-bold text-slate-950">Important incidents</h3>
              {incidentError && <p role="alert" className="mt-2 text-sm text-red-900">Incident list unavailable: {incidentError}</p>}
              {!incidentError && reportedIncidents === null && <p role="status" className="mt-2 text-sm text-slate-600">Loading reports…</p>}
              {!incidentError && reportedIncidents !== null && importantIncidents.length === 0 && (
                <p className="mt-2 text-sm text-slate-600">No open persisted incidents.</p>
              )}
              {importantIncidents.length > 0 && (
                <ul className="mt-2 divide-y divide-slate-200">
                  {importantIncidents.map(incident => (
                    <li key={incident.id}>
                      <button type="button" aria-pressed={selectedIncident?.id === incident.id}
                        onClick={() => {
                          setSelectedIncident(incident)
                          setSelectedEarthquakeId('')
                          setSelectedFeature(null)
                          if (incident.latitude !== null && incident.longitude !== null) {
                            setHazardLayers(current => ({ ...current, citizenReports: true }))
                          }
                        }}
                        className={`min-h-14 w-full rounded-md px-2 py-2 text-left ${selectedIncident?.id === incident.id ? 'bg-white ring-2 ring-cyan-700' : 'hover:bg-white'}`}>
                        <span className="block text-sm font-semibold text-slate-950">{incident.severity} · {incident.incident_type}</span>
                        <span className="mt-1 block text-xs text-slate-700">{incident.manual_location || 'Location unavailable'} · Priority {incident.priority.score}/100</span>
                        <span className="mt-1 block text-xs text-slate-600">{incident.data_class === 'simulation' ? 'Simulated demo' : 'Unverified incident report'} · {incident.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <details open={Boolean(selectedEarthquake || selectedIncident || selectedFeature)}>
                <summary className="min-h-10 cursor-pointer text-sm font-bold text-slate-950">Selected map details</summary>
                {selectedEarthquake ? (
                  <div className="mt-3 space-y-2 text-sm">
                    <p className="font-bold text-cyan-900">USGS observation · M{selectedEarthquake.magnitude ?? 'unknown'}</p>
                    <p>{selectedEarthquake.place}</p>
                    <p>{new Date(selectedEarthquake.time).toLocaleString()}</p>
                    <p>{selectedEarthquake.latitude.toFixed(4)}, {selectedEarthquake.longitude.toFixed(4)}</p>
                    <a href={selectedEarthquake.url} target="_blank" rel="noreferrer" className="font-semibold text-blue-800 underline">Open original USGS event</a>
                  </div>
                ) : selectedIncident ? (
                  <div className="mt-3 space-y-2 text-sm">
                    <p className="font-bold">{selectedIncident.severity} · {selectedIncident.incident_type}</p>
                    <p>{selectedIncident.manual_location || 'Location not provided'}</p>
                    <p>Unverified citizen report · {selectedIncident.status}</p>
                    <p>{selectedIncident.message || 'No additional message.'}</p>
                  </div>
                ) : selectedFeature ? (
                  <div className="mt-3 space-y-2 text-sm">
                    <p className="font-bold">{selectedFeature.label}</p>
                    <p>{selectedFeature.description}</p>
                    <p>{selectedFeature.latitude.toFixed(4)}, {selectedFeature.longitude.toFixed(4)}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-700">Select a marker or colored scenario cell to inspect its source and limitations.</p>
                )}
              </details>
            </aside>
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-700" aria-label="Map legend">
          <span><strong className="text-cyan-800">● USGS</strong> external observations</span>
          <span><strong className="text-orange-800">● Orange/red</strong> fictional demo fixtures</span>
          {showRegionBounds && selectedRegion && <span><strong className="text-cyan-800">▧ Cyan outline</strong> approximate bounds for {selectedRegion.name}</span>}
          {hazardLayers.citizenReports && <span><strong className="text-red-800">● Citizen report</strong> unverified API record</span>}
          {(hazardLayers.floodRisk || hazardLayers.floodPath) && <span><strong className="text-red-700">● Red/orange/green cells</strong> simulated flood risk only</span>}
          {hazardLayers.landslideZones && <span><strong className="text-amber-800">▧ Amber area</strong> synthetic landslide zone</span>}
          {hazardLayers.affectedPopulation && <span><strong className="text-sky-800">● Blue</strong> fictional settlement/population</span>}
          {hazardLayers.lowerRiskLocations && <span><strong className="text-emerald-800">● Teal</strong> potential lower-risk demo location—not guaranteed safe</span>}
          {hazardLayers.fictionalResources && <span><strong className="text-blue-800">● Blue marker</strong> fictional resource</span>}
        </div>
        <p className="text-xs text-slate-600">Map tiles: OpenStreetMap contributors. Tile label language is controlled by the map data/style and may not be English; ArkGrid cannot translate text baked into raster tiles. Event details and controls are English. Basemap tiles are not cached offline.</p>
        {!compact && selectedEarthquake && (
          <article className="rounded-lg border border-cyan-200 bg-cyan-50 p-4" aria-label="Selected USGS event details">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-bold text-cyan-950">Selected USGS observation · M{selectedEarthquake.magnitude ?? 'unknown'}</h3>
                <p className="mt-1 text-sm text-cyan-950">{selectedEarthquake.place}</p>
                <p className="mt-1 text-xs text-cyan-950">Observed {new Date(selectedEarthquake.time).toLocaleString()} · {selectedEarthquake.latitude.toFixed(4)}, {selectedEarthquake.longitude.toFixed(4)} · Depth {selectedEarthquake.depth_km ?? 'unknown'} km</p>
                <a href={selectedEarthquake.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-cyan-900 underline">Open original USGS event</a>
              </div>
              <button type="button" onClick={() => setSelectedEarthquakeId('')} className="min-h-10 rounded border border-cyan-700 bg-white px-3 text-sm font-semibold">Clear selection</button>
            </div>
          </article>
        )}
        {!compact && selectedDemoIncident && (
          <article className="rounded-lg border border-amber-300 bg-amber-50 p-4" aria-label="Selected demo incident details">
            <h3 className="font-bold text-amber-950">Demo fixture · {selectedDemoIncident.title}</h3>
            <p className="mt-1 text-sm text-amber-950">{selectedDemoIncident.id} · {selectedDemoIncident.location} · {selectedDemoIncident.severity}</p>
            <p className="mt-1 text-sm text-amber-950">{selectedDemoIncident.description}</p>
            <button type="button" onClick={() => setSelectedDemoIncidentId('')} className="mt-2 min-h-10 rounded border border-amber-500 bg-white px-3 text-sm font-semibold">Clear selection</button>
          </article>
        )}
      </section>

      {!compact && <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3 text-sm sm:col-span-3">
          <h2 className="font-semibold text-slate-900">{selectedRegion ? `${selectedRegion.name} monitoring summary` : 'Global monitoring summary'}</h2>
          {!data ? (
            <p className="mt-1 text-slate-700">{loading ? 'Loading USGS observations…' : 'USGS observations are unavailable; no count is being reported.'}</p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <p>{regionEvents.length} observation{regionEvents.length === 1 ? '' : 's'} in the selected time window</p>
              <p>{events.length} match the magnitude and place filters</p>
              <p>Strongest: {strongestRegionalEvent?.magnitude === null || !strongestRegionalEvent ? 'No magnitude reported' : `M${strongestRegionalEvent.magnitude} · ${strongestRegionalEvent.place}`}</p>
              <p className="sm:col-span-3">Most recent: {mostRecentRegionalEvent ? `${new Date(mostRecentRegionalEvent.time).toLocaleString()} · ${mostRecentRegionalEvent.place}` : 'No observations in the selected time window'}</p>
            </div>
          )}
          {selectedRegion && <p className="mt-2 text-xs text-slate-600">{selectedRegion.description} <a className="font-semibold text-cyan-900 underline" href={selectedRegion.sourceUrl} target="_blank" rel="noreferrer">{selectedRegion.sourceName}</a></p>}
        </div>
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
      </section>}

      {!compact && !loading && !error && data && events.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700">No USGS observations match the current filters. No live events are fabricated.</p>
      )}

      {!compact && events.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white px-5">
          {showEarthquakes && events.slice(0, compact ? 5 : undefined).map(event => (
            <li key={event.id} className="py-4">
              <button type="button" aria-pressed={selectedEarthquakeId === event.id}
                onClick={() => setSelectedEarthquakeId(event.id)}
                className={`w-full rounded-lg p-3 text-left ${selectedEarthquakeId === event.id ? 'bg-cyan-50 ring-2 ring-cyan-700' : 'hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-800'}`}>
                <span className="block font-semibold text-slate-950">M{event.magnitude ?? 'unknown'} · {event.place}</span>
                <span className="mt-1 block text-xs text-slate-600">{new Date(event.time).toLocaleString()} · {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}{event.depth_km !== null ? ` · ${event.depth_km} km depth` : ''}</span>
                <span className="mt-1 block text-xs font-semibold text-cyan-900">Select to inspect the corresponding map marker · External observation · USGS</span>
              </button>
              <a href={event.url} target="_blank" rel="noreferrer" className="ml-3 mt-2 inline-block text-sm font-semibold text-cyan-900 underline">USGS event details</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
