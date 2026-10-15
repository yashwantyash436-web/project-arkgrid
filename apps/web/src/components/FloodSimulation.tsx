import { useEffect, useMemo, useState } from 'react'
import { arkgridApi, ApiError } from '../api/client'
import type { Earthquake, FloodSimulationInput, FloodSimulationResponse, Incident } from '../api/types'
import {
  affectedSettlements,
  landslidePath,
  landslideRiskScore,
  lowerRiskCandidates,
  scenarioSettlements,
  syntheticLandslideCells,
} from '../data/hazardScenario'
import type { Coordinate, LandslideInputs } from '../data/hazardScenario'
import { HazardScenarioMap } from './HazardScenarioMap'
import type { ScenarioMapLayers } from './HazardScenarioMap'
import type { MapFeature } from './mapTypes'

const horizons = [0, 1, 3, 6] as const
const initialInputs: Omit<FloodSimulationInput, 'horizonHours' | 'startLatitude' | 'startLongitude'> = {
  rainfallMm: 80,
  waterLevelM: 0.5,
  riverLevelM: 1,
  terrainElevationM: 6,
  waterLevelTrendMPerHour: 0.3,
}

export function FloodSimulation({ online }: { online: boolean }) {
  const [inputs, setInputs] = useState(initialInputs)
  const [requestInputs, setRequestInputs] = useState(initialInputs)
  const [selectedStart, setSelectedStart] = useState<Coordinate>([26.75, 87.2])
  const [requestStart, setRequestStart] = useState<Coordinate>([26.75, 87.2])
  const [horizonIndex, setHorizonIndex] = useState(0)
  const [scenario, setScenario] = useState<FloodSimulationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [activeHazard, setActiveHazard] = useState<'flood' | 'landslide'>('flood')
  const [isChoosingSource, setIsChoosingSource] = useState(false)
  const [landslideInputs, setLandslideInputs] = useState<LandslideInputs>({
    rainfallMm: 180,
    slope: 'steep',
    soil: 'moist',
  })
  const [landslideStart, setLandslideStart] = useState<Coordinate>([26.79, 87.34])
  const [landslideRiskThreshold, setLandslideRiskThreshold] = useState(0.45)
  const [riskThreshold, setRiskThreshold] = useState(0.45)
  const [layers, setLayers] = useState<ScenarioMapLayers>({
    earthquakes: false,
    citizenReports: false,
    floodRisk: true,
    floodPath: true,
    landslideZones: false,
    affectedPopulation: true,
    lowerRiskLocations: true,
    fictionalResources: false,
  })
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([])
  const [earthquakeError, setEarthquakeError] = useState('')
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [incidentError, setIncidentError] = useState('')
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null)
  const [alertReviewOpen, setAlertReviewOpen] = useState(false)
  const [alertActivity, setAlertActivity] = useState<{ id: number; time: string; hazard: string; recipientCount: number; population: number }[]>([])
  const horizon = horizons[horizonIndex]
  const scenarioOrigin = useMemo<Coordinate>(
    () => scenario
      ? [scenario.inputs.start_latitude, scenario.inputs.start_longitude]
      : requestStart,
    [requestStart, scenario],
  )
  const floodPath = useMemo(() => scenario?.propagation_path ?? [], [scenario])
  const floodMaximumRisk = scenario?.cells.reduce((maximum, cell) => Math.max(maximum, cell.risk_score), 0) ?? 0
  const floodAffectedSettlements = useMemo(
    () => affectedSettlements(floodPath, scenarioOrigin, floodMaximumRisk, 4),
    [floodMaximumRisk, floodPath, scenarioOrigin],
  )
  const floodCandidates = useMemo(
    () => lowerRiskCandidates(floodPath, scenarioOrigin, floodAffectedSettlements, riskThreshold, 8),
    [floodAffectedSettlements, floodPath, riskThreshold, scenarioOrigin],
  )
  const landslideScore = landslideRiskScore(landslideInputs)
  const activeLandslidePath = useMemo(
    () => activeHazard === 'landslide' ? landslidePath(landslideStart, landslideInputs) : [],
    [activeHazard, landslideInputs, landslideStart],
  )
  const landslideCells = activeHazard === 'landslide'
    ? syntheticLandslideCells(activeLandslidePath, landslideScore)
    : []
  const landslideAffectedSettlements = useMemo(
    () => affectedSettlements(activeLandslidePath, landslideStart, landslideScore, 3),
    [activeLandslidePath, landslideScore, landslideStart],
  )
  const landslideCandidates = useMemo(
    () => lowerRiskCandidates(activeLandslidePath, landslideStart, landslideAffectedSettlements, landslideRiskThreshold, 5),
    [activeLandslidePath, landslideAffectedSettlements, landslideRiskThreshold, landslideStart],
  )
  const affectedSettlementsForActiveHazard = activeHazard === 'flood'
    ? floodAffectedSettlements
    : landslideAffectedSettlements
  const candidatesForActiveHazard = activeHazard === 'flood'
    ? floodCandidates
    : landslideCandidates
  const illustrativePopulation = affectedSettlementsForActiveHazard.reduce((total, settlement) => total + settlement.population, 0)
  const recommendedLocation = candidatesForActiveHazard.find(candidate => candidate.recommended)

  useEffect(() => {
    if (!online) return
    let active = true
    const request: FloodSimulationInput = {
      ...requestInputs,
      horizonHours: horizon,
      startLatitude: requestStart[0],
      startLongitude: requestStart[1],
    }
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
  }, [horizon, online, requestInputs, requestStart])

  useEffect(() => {
    let active = true
    void arkgridApi.earthquakes(-2)
      .then(result => {
        if (active) {
          setEarthquakes(result.items)
          setEarthquakeError(result.stale ? result.error ?? 'The last successful feed is stale.' : '')
        }
      })
      .catch(cause => {
        if (active) setEarthquakeError(cause instanceof ApiError ? cause.message : 'USGS observations are unavailable.')
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    void arkgridApi.incidents()
      .then(result => {
        if (active) {
          setIncidents(result.items)
          setIncidentError('')
        }
      })
      .catch(cause => {
        if (active) setIncidentError(cause instanceof ApiError ? cause.message : 'Citizen reports are unavailable.')
      })
    return () => { active = false }
  }, [])

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
  const currentOrigin: Coordinate = activeHazard === 'flood'
    ? scenarioOrigin
    : landslideStart
  const currentSettlements = activeHazard === 'flood'
    ? scenarioSettlements(scenarioOrigin)
    : scenarioSettlements(landslideStart)
  const activeAffectedIds = new Set(affectedSettlementsForActiveHazard.map(settlement => settlement.id))

  function toggleLayer(layer: keyof ScenarioMapLayers) {
    setLayers(current => ({ ...current, [layer]: !current[layer] }))
  }

  function generateDemoAlert() {
    const recipientCount = affectedSettlementsForActiveHazard.length
    if (recipientCount === 0) return
    const confirmed = window.confirm(
      `Generate a local demo-only alert preview for ${recipientCount} fictional settlement contact(s)? No phone number will be dialed and no message will be sent.`,
    )
    if (!confirmed) return
    setAlertActivity(current => [{
      id: Date.now(),
      time: new Date().toLocaleString(),
      hazard: activeHazard,
      recipientCount,
      population: illustrativePopulation,
    }, ...current])
    setAlertReviewOpen(false)
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-5" aria-labelledby="flood-demo-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-amber-900">DEMO SIMULATION · synthetic inputs</p>
            <h2 id="flood-demo-title" className="mt-1 text-lg font-bold text-slate-950">
              {activeHazard === 'flood' ? 'Flood-risk model and scenario routing' : 'Landslide scenario demonstration'}
            </h2>
            <p className="mt-2 inline-flex rounded-md border border-amber-500 bg-white px-3 py-2 text-sm font-extrabold text-amber-950">
              {activeHazard === 'flood'
                ? 'SIMULATED SCENARIO — NOT A REAL-WORLD FLOOD FORECAST'
                : 'SIMULATED LANDSLIDE SCENARIO — DEMONSTRATION ONLY'}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-800">
              {activeHazard === 'flood'
                ? 'The existing backend logistic model is trained on reproducible synthetic labels. Its uncalibrated risk score is not a flood probability. The grid and route graph are invented; no rainfall, river, terrain, or measured flood data is connected.'
                : 'This is a deterministic demonstration rule, not a scientific landslide model. The slope, soil, corridor, and risk levels are illustrative inputs; no terrain, geology, rainfall observation, or validated landslide data is connected.'}
            </p>
          </div>
          <span className="rounded-full border border-amber-400 bg-white px-3 py-1 text-xs font-bold text-amber-950">NOT OPERATIONAL GUIDANCE</span>
        </div>
      </section>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Choose a separate synthetic hazard scenario">
        <button type="button" role="tab" aria-selected={activeHazard === 'flood'} onClick={() => {
          setActiveHazard('flood')
          setIsChoosingSource(false)
          setAlertReviewOpen(false)
          setLayers(current => ({ ...current, floodRisk: true, floodPath: true, landslideZones: false }))
        }} className={`min-h-12 rounded-lg px-5 font-bold ${activeHazard === 'flood' ? 'bg-slate-900 text-white' : 'border border-slate-400 bg-white'}`}>
          Flood scenario · API model
        </button>
        <button type="button" role="tab" aria-selected={activeHazard === 'landslide'} onClick={() => {
          setActiveHazard('landslide')
          setIsChoosingSource(false)
          setAlertReviewOpen(false)
          setLayers(current => ({ ...current, floodRisk: false, floodPath: false, landslideZones: true }))
        }} className={`min-h-12 rounded-lg px-5 font-bold ${activeHazard === 'landslide' ? 'bg-slate-900 text-white' : 'border border-slate-400 bg-white'}`}>
          Landslide scenario · synthetic rule
        </button>
      </div>

      {activeHazard === 'flood' ? (
      <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Synthetic flood scenario controls">
        <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" onSubmit={event => {
          event.preventDefault()
          if (!online) return
          setIsPlaying(false)
          setLoading(true)
          setError('')
          setRequestInputs({ ...inputs })
          setRequestStart(selectedStart)
          setAlertReviewOpen(false)
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
            <p className="mb-2 text-sm">Starting point: <strong>{selectedStart[0].toFixed(4)}, {selectedStart[1].toFixed(4)}</strong> · selected manually on the map; no live water source is known.</p>
            <button type="button" className={`mr-3 min-h-11 rounded-lg border px-4 text-sm font-semibold ${isChoosingSource ? 'border-cyan-800 bg-cyan-50 text-cyan-950' : 'border-slate-400 bg-white'}`}
              onClick={() => setIsChoosingSource(current => !current)}>
              {isChoosingSource ? 'Tap the map to choose source…' : 'Choose starting point on map'}
            </button>
            <button type="submit" className="min-h-11 rounded-lg bg-slate-900 px-5 text-sm font-bold text-white disabled:opacity-60" disabled={!online || loading}>
              {online && loading ? 'Updating scenario…' : 'Run synthetic scenario'}
            </button>
          </div>
        </form>
      </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Synthetic landslide scenario controls">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-1 text-sm font-semibold">Rainfall intensity · synthetic mm
              <input aria-label="Landslide rainfall intensity" type="number" min="0" max="400" step="10" value={landslideInputs.rainfallMm}
                onChange={event => setLandslideInputs(current => ({ ...current, rainfallMm: Math.max(0, Math.min(400, Number(event.target.value) || 0)) }))}
                className="min-h-11 rounded-lg border border-slate-300 px-3" />
            </label>
            <label className="grid gap-1 text-sm font-semibold">Illustrative slope category
              <select aria-label="Slope category" value={landslideInputs.slope} onChange={event => setLandslideInputs(current => ({ ...current, slope: event.target.value as LandslideInputs['slope'] }))} className="min-h-11 rounded-lg border border-slate-300 px-3">
                <option value="gentle">Gentle</option><option value="moderate">Moderate</option><option value="steep">Steep</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">Illustrative soil condition
              <select aria-label="Soil condition" value={landslideInputs.soil} onChange={event => setLandslideInputs(current => ({ ...current, soil: event.target.value as LandslideInputs['soil'] }))} className="min-h-11 rounded-lg border border-slate-300 px-3">
                <option value="dry">Dry (demo)</option><option value="moist">Moist (demo)</option><option value="saturated">Saturated (demo)</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">Starting area
              <span className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-normal">{landslideStart[0].toFixed(4)}, {landslideStart[1].toFixed(4)}</span>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className={`min-h-11 rounded-lg border px-4 text-sm font-semibold ${isChoosingSource ? 'border-cyan-800 bg-cyan-50 text-cyan-950' : 'border-slate-400 bg-white'}`}
              onClick={() => setIsChoosingSource(current => !current)}>
              {isChoosingSource ? 'Tap the map to choose slope…' : 'Choose illustrative slope on map'}
            </button>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">Maximum candidate risk score
              <input aria-label="Landslide lower-risk threshold" type="range" min="0.1" max="0.8" step="0.05" value={landslideRiskThreshold}
                onChange={event => setLandslideRiskThreshold(Number(event.target.value))} />
              <span>{landslideRiskThreshold.toFixed(2)}</span>
            </label>
            <p className="text-sm">Synthetic rule score: <strong>{landslideScore.toFixed(2)} / 1.00</strong> · not a probability</p>
          </div>
        </section>
      )}

      <section className="grid min-w-0 gap-4 rounded-xl border border-slate-200 bg-white p-5">
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-950">Potentially affected simulation cells · +{horizon} h</h3>
              <p className="mt-1 text-xs text-slate-600">Synthetic grid near the selected scenario source; the display direction is assumed south-east.</p>
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
        </div>

        <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label="Scenario map layers">
          <legend className="px-1 text-sm font-bold">Map layers · select what to show</legend>
          <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={layers.earthquakes} onChange={() => toggleLayer('earthquakes')} />USGS earthquake observations</label>
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={layers.citizenReports} onChange={() => toggleLayer('citizenReports')} />Citizen report points</label>
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={layers.floodRisk} onChange={() => toggleLayer('floodRisk')} />Synthetic flood-risk heat layer</label>
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={layers.floodPath} onChange={() => toggleLayer('floodPath')} />Flood propagation corridor</label>
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={layers.landslideZones} onChange={() => toggleLayer('landslideZones')} />Landslide assessment zone</label>
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={layers.affectedPopulation} onChange={() => toggleLayer('affectedPopulation')} />Fictional settlements/population</label>
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={layers.lowerRiskLocations} onChange={() => toggleLayer('lowerRiskLocations')} />Potentially lower-risk locations</label>
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={layers.fictionalResources} onChange={() => toggleLayer('fictionalResources')} />Fictional resources</label>
          </div>
          {layers.earthquakes && earthquakeError && <p role="alert" className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-950">USGS data unavailable or stale: {earthquakeError}. No new observations are fabricated.</p>}
          {layers.citizenReports && incidentError && <p role="alert" className="mt-2 rounded bg-red-50 p-2 text-sm text-red-900">Citizen reports unavailable: {incidentError}. No report markers were fabricated.</p>}
          {layers.earthquakes && !earthquakeError && earthquakes.length === 0 && <p className="mt-2 text-sm text-slate-700">No current USGS observations are available to show.</p>}
          {layers.citizenReports && !incidentError && incidents.every(incident => incident.latitude === null || incident.longitude === null) && <p className="mt-2 text-sm text-slate-700">No API citizen reports have coordinates to plot.</p>}
        </fieldset>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-950">
                  {activeHazard === 'flood' ? `Flood scenario cells · +${horizon} h` : 'Landslide scenario assessment cells'}
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  {isChoosingSource
                    ? 'Tap or click the map to select a synthetic starting area.'
                    : activeHazard === 'flood'
                      ? 'The backend returns a fixed-resolution synthetic grid translated to your selected point. The displayed direction is a deterministic demo rule, not hydrological flow.'
                      : 'The corridor direction follows a deterministic south-east display rule. Its score is a demonstration heuristic, not a calibrated probability.'}
                </p>
              </div>
            </div>
            <div className="h-[420px] overflow-hidden rounded-lg border border-slate-200 sm:h-[500px]">
              <HazardScenarioMap
                center={currentOrigin}
                sourceSelectable={isChoosingSource}
                onSourceSelect={point => {
                  if (activeHazard === 'flood') {
                    setSelectedStart(point)
                  } else {
                    setLandslideStart(point)
                  }
                  setIsChoosingSource(false)
                }}
                floodScenario={activeHazard === 'flood' ? visibleScenario : null}
                landslidePath={activeLandslidePath}
                landslideCells={landslideCells}
                landslideRisk={landslideScore}
                settlements={currentSettlements}
                affectedSettlementIds={activeAffectedIds}
                candidates={candidatesForActiveHazard}
                earthquakes={earthquakes}
                incidents={incidents}
                layers={layers}
                onFeatureSelect={setSelectedFeature}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs font-medium text-slate-700" role="group" aria-label="Scenario map legend">
              <span><strong className="text-red-800">● Red</strong> higher synthetic risk</span>
              <span><strong className="text-amber-800">● Orange</strong> elevated synthetic risk</span>
              <span><strong className="text-emerald-800">● Teal</strong> lower synthetic risk</span>
              <span><strong className="text-sky-800">● Blue</strong> fictional settlements</span>
              <span><strong className="text-purple-800">● Purple</strong> actual USGS observations (when available)</span>
            </div>
          </div>

          <div className="space-y-4">
            {activeHazard === 'flood' ? (
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="font-bold text-slate-950">Flood scenario output</h3>
                {!online && <p role="alert" className="mt-2 text-sm text-amber-950">Offline: the flood model and scenario are not cached for offline use. Reconnect to the ArkGrid API before recomputing; no result is guessed or reused.</p>}
                {online && loading && <p role="status" className="mt-2 text-sm text-slate-700">Calculating synthetic scenario…</p>}
                {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
                {visibleScenario && !loading && (
                  <>
                    <p className="mt-2 text-sm">Overall scenario class: <strong className="uppercase">{visibleScenario.risk_class}</strong></p>
                    <p className="mt-1 text-xs text-slate-600">Model {visibleScenario.model.version} · {visibleScenario.model.algorithm} · {visibleScenario.model.synthetic_training_rows.toLocaleString()} synthetic training examples.</p>
                    <p className="mt-2 text-sm">Selected illustrative route: <strong>{chosenRoute?.label ?? 'No candidate'}</strong></p>
                    {chosenRoute && <p className="mt-1 text-xs text-slate-600">{chosenRoute.distance_km.toFixed(1)} synthetic km · {chosenRoute.high_risk_segments} higher-risk graph segment(s). This route is unrelated to the synthetic flood-propagation corridor and is not operational guidance.</p>}
                    <label className="mt-3 grid gap-1 text-sm font-semibold">Maximum illustrative candidate risk score
                      <input aria-label="Flood lower-risk threshold" type="range" min="0.1" max="0.8" step="0.05" value={riskThreshold} onChange={event => setRiskThreshold(Number(event.target.value))} />
                      <span className="text-xs font-normal">{riskThreshold.toFixed(2)} / 1.00 · candidates above this score or inside the corridor are excluded</span>
                    </label>
                    {visibleScenario.route_warning && <p role="alert" className="mt-2 rounded bg-red-100 p-2 text-sm font-semibold text-red-950">{visibleScenario.route_warning}</p>}
                  </>
                )}
              </section>
            ) : (
              <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                <h3 className="font-bold text-amber-950">Landslide demonstration result</h3>
                <p className="mt-2 text-sm">Illustrative instability rule score: <strong>{landslideScore.toFixed(2)}</strong> · not a probability or forecast.</p>
                <p className="mt-2 text-xs leading-5">Deterministic formula: 35% normalized synthetic rainfall + 35% selected slope factor + 30% selected soil factor. Corridor length changes with selected slope and rainfall. It is not a physical runout model.</p>
              </section>
            )}

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="font-bold text-slate-950">Potentially affected demo settlements</h3>
              <p className="mt-1 text-sm text-slate-700">{affectedSettlementsForActiveHazard.length} fictional settlement(s) · estimated {illustrativePopulation.toLocaleString()} illustrative people.</p>
              <p className="mt-1 text-xs text-slate-600">Counts are generated from fictional settlement points within the shown corridor. They are not census data.</p>
              {affectedSettlementsForActiveHazard.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">No synthetic settlement meets the selected scenario rule; no affected population is estimated.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {affectedSettlementsForActiveHazard.map(settlement => <li key={settlement.id} className="rounded bg-red-50 p-2">
                    <strong>{settlement.name}</strong> · simulated population {settlement.population.toLocaleString()}
                  </li>)}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <h3 className="font-bold text-emerald-950">Potentially lower-risk demonstration locations</h3>
              <p className="mt-1 text-xs text-emerald-950">Rule: exclude candidates inside the corridor or above the selected risk threshold; rank remaining places by distance from the affected area, then by score. These are fictional and not guaranteed safe.</p>
              {candidatesForActiveHazard.filter(candidate => candidate.recommended).length === 0 ? (
                <p className="mt-2 text-sm font-semibold text-emerald-950">No candidate meets the selected rules. Do not treat an excluded place as safe.</p>
              ) : (
                <ul className="mt-3 space-y-3 text-sm">
                  {candidatesForActiveHazard.map(candidate => <li key={candidate.id} className="rounded-lg border border-emerald-200 bg-white p-3">
                    <p className="font-bold">{candidate.name}</p>
                    <p>{candidate.recommended ? 'Potentially lower-risk demonstration location' : candidate.reason}</p>
                    <p>Illustrative distance: {candidate.distanceKm.toFixed(1)} km · risk score: {candidate.riskScore.toFixed(2)} · example capacity: {candidate.capacity}</p>
                    {candidate.recommended && <p className="text-xs text-emerald-900">{candidate.reason}</p>}
                  </li>)}
                </ul>
              )}
            </section>

            {selectedFeature && <section className="rounded-lg border border-blue-200 bg-blue-50 p-4" aria-label="Selected map detail">
              <h3 className="font-bold">{selectedFeature.label}</h3>
              <p className="mt-1 text-sm">{selectedFeature.description}</p>
              <p className="mt-1 text-xs">{selectedFeature.latitude.toFixed(4)}, {selectedFeature.longitude.toFixed(4)}</p>
              <button type="button" className="mt-2 min-h-10 rounded border border-slate-400 bg-white px-3 text-sm font-semibold" onClick={() => setSelectedFeature(null)}>Clear selection</button>
            </section>}
          </div>
        </div>

          {activeHazard === 'flood' && <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="font-bold text-slate-950">Scenario timeline</h3>
            {visibleScenario?.timeline.map(step => (
              <div key={step.hour} className={`mt-2 flex justify-between gap-3 rounded px-2 py-1 text-sm ${step.hour === horizon ? 'bg-slate-100 font-bold' : ''}`}>
                <span>{step.hour === 0 ? 'Now' : `+${step.hour} hours`}</span>
                <span>{step.moderate_or_high_cells} / 12 cells moderate/high</span>
              </div>
            ))}
          </section>}

          <section className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h3 className="font-bold text-red-950">Real-data mode · not available</h3>
            <p className="mt-1 text-sm leading-5 text-red-950">{activeHazard === 'flood'
              ? 'No rainfall observations, river gauges, forecast, elevation raster, validated flood extents, or road graph are connected. Real-world flood risk and operational route planning are therefore unavailable.'
              : 'No real slope/elevation raster, soil/geology observations, rainfall measurements, or validated landslide model are connected. Real-world landslide risk is unavailable.'}</p>
          </section>

          <p className="text-xs leading-5 text-slate-600">{activeHazard === 'flood'
            ? visibleScenario?.source ?? 'The model runs via the ArkGrid API; no scenario inputs or model are cached offline.'
            : 'Landslide demonstration formula and geometry run locally from the selected synthetic inputs.'} No location is guaranteed safe. Follow official emergency instructions and do not use these outputs for evacuation decisions.</p>

          <section className="rounded-xl border border-blue-200 bg-blue-50 p-5" aria-label="Demo alert workflow">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-blue-950">Simulated alert review · no messages sent</h3>
                <p className="mt-1 text-sm text-blue-950">This review uses only synthetic settlements and non-dialable demo identifiers. It does not contact people or open an SMS application.</p>
              </div>
              <button type="button" disabled={affectedSettlementsForActiveHazard.length === 0}
                onClick={() => setAlertReviewOpen(current => !current)}
                className="min-h-11 rounded-lg bg-blue-900 px-4 text-sm font-bold text-white disabled:bg-slate-400">
                {alertReviewOpen ? 'Close proposed alert' : 'Review proposed demo alert'}
              </button>
            </div>
            {alertReviewOpen && (
              <div className="mt-4 space-y-3 rounded-lg border border-blue-200 bg-white p-4">
                <p className="text-sm font-semibold">Affected synthetic locations: {affectedSettlementsForActiveHazard.length} · illustrative people: {illustrativePopulation.toLocaleString()}</p>
                <ul className="list-inside list-disc text-sm">
                  {affectedSettlementsForActiveHazard.map((settlement, index) => <li key={settlement.id}>{settlement.name} · DEMO recipient ID DEMO-PHONE-{String(index + 1).padStart(3, '0')} (fictional, not dialable)</li>)}
                </ul>
                <p className="rounded bg-slate-50 p-3 text-sm leading-6">
                  DEMO ALERT: A simulated {activeHazard} scenario may affect your selected area. Please follow official emergency instructions. {recommendedLocation
                    ? `A potentially lower-risk demonstration location is ${recommendedLocation.name}.`
                    : 'No potentially lower-risk demonstration location is available under the selected rules.'} This is a prototype message, not an official emergency warning.
                </p>
                <p className="text-xs text-slate-600">Outcome will be recorded as “demo alert generated locally”; it does not prove delivery.</p>
                <button type="button" onClick={generateDemoAlert} className="min-h-11 rounded-lg bg-blue-900 px-4 text-sm font-bold text-white">Confirm demo alert generation</button>
              </div>
            )}
            <ol className="mt-4 space-y-2 text-sm" aria-label="Simulated alert activity log">
              {alertActivity.length === 0 ? <li className="text-slate-700">No demonstration alerts generated this session.</li> : alertActivity.map(item => (
                <li key={item.id} className="rounded border border-blue-200 bg-white p-3">
                  {item.time} · Demo {item.hazard} alert generated locally for {item.recipientCount} fictional location(s) / {item.population.toLocaleString()} simulated people. No SMS sent; delivery is not applicable.
                </li>
              ))}
            </ol>
          </section>
      </section>
    </div>
  )
}
