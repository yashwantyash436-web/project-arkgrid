import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet'
import { arkgridApi, ApiError } from '../api/client'
import type { FloodSimulationInput, FloodSimulationResponse } from '../api/types'

const horizons = [0, 1, 3, 6] as const
const initialInputs = {
  rainfallMm: 80,
  waterLevelM: 0.5,
  riverLevelM: 1,
  terrainElevationM: 6,
  waterLevelTrendMPerHour: 0.3,
}

function riskColor(risk: 'low' | 'moderate' | 'high'): string {
  if (risk === 'high') return '#b42318'
  if (risk === 'moderate') return '#c27a18'
  return '#07836f'
}

export function FloodSimulation({ online }: { online: boolean }) {
  const [inputs, setInputs] = useState(initialInputs)
  const [requestInputs, setRequestInputs] = useState(initialInputs)
  const [horizonIndex, setHorizonIndex] = useState(0)
  const [scenario, setScenario] = useState<FloodSimulationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const horizon = horizons[horizonIndex]

  useEffect(() => {
    if (!online) return
    let active = true
    const request: FloodSimulationInput = { ...requestInputs, horizonHours: horizon }
    void arkgridApi.floodDemoSimulation(request)
      .then(result => {
        if (active) setScenario(result)
      })
      .catch(cause => {
        if (active) {
          setScenario(null)
          setError(cause instanceof ApiError ? cause.message : 'The flood simulation could not be loaded.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [horizon, online, requestInputs])

  useEffect(() => {
    if (!isPlaying || !online) return
    const timer = window.setInterval(() => {
      setLoading(true)
      setHorizonIndex(current => {
        if (current >= horizons.length - 1) {
          setIsPlaying(false)
          return current
        }
        return current + 1
      })
    }, 1800)
    return () => window.clearInterval(timer)
  }, [isPlaying, online])

  function updateInput(key: keyof typeof inputs, value: string) {
    const parsed = Number(value)
    setInputs(current => ({ ...current, [key]: Number.isFinite(parsed) ? parsed : 0 }))
  }

  const visibleScenario = online ? scenario : null
  const chosenRoute = visibleScenario?.routes.find(route => route.id === visibleScenario.selected_route_id)

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-5" aria-labelledby="flood-demo-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-amber-900">DEMO SIMULATION · synthetic inputs</p>
            <h2 id="flood-demo-title" className="mt-1 text-lg font-bold text-slate-950">Flood-risk model and scenario routing</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-800">
              Synthetic demonstration—not a validated real-world flood forecast. Logistic regression is trained on reproducible synthetic labels. The risk score is uncalibrated and is not a flood probability.
              This grid and its road graph are invented for demonstration, not measured geography.
            </p>
          </div>
          <span className="rounded-full border border-amber-400 bg-white px-3 py-1 text-xs font-bold text-amber-950">NOT OPERATIONAL GUIDANCE</span>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Synthetic flood scenario controls">
        <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" onSubmit={event => {
          event.preventDefault()
          if (!online) return
          setIsPlaying(false)
          setLoading(true)
          setError('')
          setRequestInputs({ ...inputs })
        }}>
          <label className="grid gap-1 text-sm font-semibold">Rainfall (synthetic mm)
            <input aria-label="Rainfall (synthetic mm)" type="number" min="0" max="500" step="5" value={inputs.rainfallMm} onChange={event => updateInput('rainfallMm', event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3" />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Water level (synthetic m)
            <input aria-label="Water level (synthetic m)" type="number" min="0" max="20" step="0.1" value={inputs.waterLevelM} onChange={event => updateInput('waterLevelM', event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3" />
          </label>
          <label className="grid gap-1 text-sm font-semibold">River level (synthetic m)
            <input aria-label="River level (synthetic m)" type="number" min="0" max="20" step="0.1" value={inputs.riverLevelM} onChange={event => updateInput('riverLevelM', event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3" />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Terrain baseline (synthetic m)
            <input aria-label="Terrain baseline (synthetic m)" type="number" min="0" max="100" step="0.5" value={inputs.terrainElevationM} onChange={event => updateInput('terrainElevationM', event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3" />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Water-level trend (synthetic m/hour)
            <input aria-label="Water-level trend (synthetic m/hour)" type="number" min="-5" max="5" step="0.1" value={inputs.waterLevelTrendMPerHour} onChange={event => updateInput('waterLevelTrendMPerHour', event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3" />
          </label>
          <div className="sm:col-span-2 xl:col-span-5">
            <button type="submit" className="min-h-11 rounded-lg bg-slate-900 px-5 text-sm font-bold text-white disabled:opacity-60" disabled={!online || loading}>
              {online && loading ? 'Updating scenario…' : 'Run synthetic scenario'}
            </button>
          </div>
        </form>
      </section>

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-950">Potentially affected simulation cells · +{horizon} h</h3>
              <p className="mt-1 text-xs text-slate-600">Synthetic grid near the illustrative Koshi scenario pin; flow axis is assumed south-east.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="min-h-10 rounded-lg border border-slate-400 px-3 text-sm font-semibold" disabled={!online} onClick={() => setIsPlaying(value => !value)}>{isPlaying ? 'Pause' : 'Play timeline'}</button>
              <label className="sr-only" htmlFor="flood-time-slider">Forecast timeline</label>
              <input id="flood-time-slider" aria-label="Forecast timeline" type="range" min="0" max={horizons.length - 1} step="1" value={horizonIndex} disabled={!online} onChange={event => { setIsPlaying(false); setLoading(true); setError(''); setHorizonIndex(Number(event.target.value)) }} />
            </div>
          </div>
          <div className="mb-3 flex justify-between text-xs font-semibold text-slate-700" aria-label="Timeline steps">
            {horizons.map((hour, index) => <button key={hour} type="button" disabled={!online} aria-pressed={index === horizonIndex} onClick={() => { setIsPlaying(false); setLoading(true); setError(''); setHorizonIndex(index) }} className="min-h-9 px-2">{hour === 0 ? 'Now' : `+${hour} h`}</button>)}
          </div>
          <div className="h-[360px] overflow-hidden rounded-lg border border-slate-200">
            <MapContainer center={[26.75, 87.27]} zoom={11} className="h-full w-full">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <CircleMarker center={[26.75, 87.2]} radius={8} pathOptions={{ color: '#172033', fillColor: '#fff', fillOpacity: 1 }}>
                <Popup>Starting reference point · synthetic scenario</Popup>
              </CircleMarker>
              {visibleScenario?.cells.map(cell => (
                <CircleMarker key={cell.id} center={[cell.latitude, cell.longitude]} radius={13}
                  pathOptions={{ color: riskColor(cell.risk_class), fillColor: riskColor(cell.risk_class), fillOpacity: 0.62, weight: 2 }}>
                  <Popup>
                    <strong>{cell.risk_class.toUpperCase()} · synthetic cell</strong><br />
                    Cell {cell.id}<br />
                    Uncalibrated synthetic risk score: {cell.risk_score.toFixed(2)}<br />
                    Scenario elevation: {cell.elevation_m.toFixed(1)} m
                  </Popup>
                </CircleMarker>
              ))}
              {visibleScenario?.routes.map(route => (
                <Polyline key={route.id} positions={route.geometry} pathOptions={{
                  color: route.id === visibleScenario.selected_route_id ? '#087f5b' : '#2563a6',
                  weight: route.id === visibleScenario.selected_route_id ? 6 : 3,
                  dashArray: route.id === visibleScenario.selected_route_id ? undefined : '7 7',
                }}>
                  <Popup>{route.label} · illustrative only · {route.distance_km.toFixed(1)} synthetic km</Popup>
                </Polyline>
              ))}
            </MapContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs font-medium text-slate-700" aria-label="Flood simulation legend">
            <span><strong className="text-emerald-800">●</strong> Lower synthetic risk</span>
            <span><strong className="text-amber-800">●</strong> Moderate synthetic risk</span>
            <span><strong className="text-red-800">●</strong> Higher synthetic risk</span>
            <span>— Selected illustrative route · - - Alternative</span>
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="font-bold text-slate-950">Scenario output</h3>
            {!online && <p role="alert" className="mt-2 text-sm text-amber-950">Offline: the flood model and scenario are not cached for offline use. Reconnect to the ArkGrid API before recomputing; no result is guessed or reused.</p>}
            {online && loading && <p role="status" className="mt-2 text-sm text-slate-700">Calculating synthetic scenario…</p>}
            {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
            {visibleScenario && !loading && (
              <>
                <p className="mt-2 text-sm">Overall scenario class: <strong className="uppercase">{visibleScenario.risk_class}</strong></p>
                <p className="mt-1 text-xs text-slate-600">Model {visibleScenario.model.version} · {visibleScenario.model.algorithm} · {visibleScenario.model.synthetic_training_rows.toLocaleString()} synthetic training examples.</p>
                <p className="mt-2 text-sm">Selected illustrative route: <strong>{chosenRoute?.label ?? 'No candidate'}</strong></p>
                {chosenRoute && <p className="mt-1 text-xs text-slate-600">{chosenRoute.distance_km.toFixed(1)} synthetic km · {chosenRoute.high_risk_segments} higher-risk graph segment(s). The score balances synthetic exposure and an illustrative distance penalty. It is not driving time or operational route guidance.</p>}
                {visibleScenario.route_warning && <p role="alert" className="mt-2 rounded bg-red-100 p-2 text-sm font-semibold text-red-950">{visibleScenario.route_warning}</p>}
              </>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-slate-950">Scenario timeline</h3>
            {visibleScenario?.timeline.map(step => (
              <div key={step.hour} className={`mt-2 flex justify-between gap-3 rounded px-2 py-1 text-sm ${step.hour === horizon ? 'bg-slate-100 font-bold' : ''}`}>
                <span>{step.hour === 0 ? 'Now' : `+${step.hour} hours`}</span>
                <span>{step.moderate_or_high_cells} / 12 cells moderate/high</span>
              </div>
            ))}
          </section>

          <section className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h3 className="font-bold text-red-950">Real-data mode · not available</h3>
            <p className="mt-1 text-sm leading-5 text-red-950">No rainfall observations, river gauges, forecast, elevation raster, validated flood extents, or road graph are connected. Real-world risk and operational route planning are therefore unavailable.</p>
          </section>

          <p className="text-xs leading-5 text-slate-600">{visibleScenario?.source ?? 'The model runs via the ArkGrid API; no scenario inputs or model are cached offline.'} No route is guaranteed safe. Do not use these scenario outputs for evacuation decisions.</p>
        </div>
      </section>
    </div>
  )
}
