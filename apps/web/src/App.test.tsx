import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import App from './App'
import type { Incident, ResourceResponse } from './api/types'
import { emergencyStorage } from './emergency/storage'

const { api } = vi.hoisted(() => ({
  api: {
    health: vi.fn(async () => ({ status: 'ok', database: 'sqlite', time: '2026-10-14T00:00:00Z' })),
    earthquakes: vi.fn(async () => ({
      items: [],
      total: 0,
      source_name: 'USGS',
      source_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      data_class: 'external_observation' as const,
      fetched_at: '2026-10-14T00:00:00Z',
      stale: false,
      error: null,
      disclaimer: 'Observations only',
    })),
    incidents: vi.fn(async (): Promise<{ items: Incident[]; total: number }> => ({ items: [], total: 0 })),
    resources: vi.fn(async (): Promise<ResourceResponse> => ({ items: [], total: 0, connected_real_resources: 0, notice: 'fictional demo resources' })),
    updateIncident: vi.fn(),
    sourceStatuses: vi.fn(async () => ({ items: [], checked_at: '2026-10-14T00:00:00Z' })),
    createIncident: vi.fn(async () => ({ id: 'incident-demo-1' })),
    syncEmergencyReport: vi.fn(async () => ({
      serverId: 'incident-server-1',
      synchronizedAt: '2026-10-14T00:00:00Z',
    })),
    floodDemoSimulation: vi.fn(async () => ({
      scenario_id: 'koshi-synthetic-demo',
      data_mode: 'DEMO SIMULATION' as const,
      risk_class: 'low' as const,
      horizon_hours: 0 as const,
      inputs: { rainfall_mm: 80, water_level_m: 0.5, river_level_m: 1, terrain_elevation_m: 6, water_level_trend_m_per_hour: 0.3, start_latitude: 26.75, start_longitude: 87.2 },
      start_location: { latitude: 26.75, longitude: 87.2 },
      propagation_path: [[26.75, 87.2], [26.715, 87.245], [26.68, 87.29], [26.645, 87.335]] as [number, number][],
      cells: [{ id: 'cell-0-0', latitude: 26.75, longitude: 87.2, elevation_m: 8, risk_score: 0.2, risk_class: 'low' as const }],
      timeline: [{ hour: 0 as const, high_risk_cells: 0, moderate_or_high_cells: 0 }, { hour: 1 as const, high_risk_cells: 0, moderate_or_high_cells: 2 }, { hour: 3 as const, high_risk_cells: 1, moderate_or_high_cells: 4 }, { hour: 6 as const, high_risk_cells: 2, moderate_or_high_cells: 8 }],
      routes: [
        { id: 'short-lowbank', label: 'Short east-bank demo road', geometry: [[26.735, 87.19], [26.735, 87.37]] as [number, number][], distance_km: 4.2, mean_exposure_score: 0.2, high_risk_segments: 0, illustrative_route_score: 0.45 },
        { id: 'raised-detour', label: 'Raised-ground demo detour', geometry: [[26.79, 87.19], [26.79, 87.37]] as [number, number][], distance_km: 5.8, mean_exposure_score: 0.1, high_risk_segments: 0, illustrative_route_score: 0.45 },
      ],
      selected_route_id: 'short-lowbank',
      route_warning: null,
      model: {
        version: 'arkgrid-flood-logistic-synthetic-v1',
        algorithm: 'class-weighted logistic regression',
        score_kind: 'uncalibrated synthetic-risk score; not a flood probability',
        synthetic_training_rows: 3000,
        synthetic_held_out_rows: 750,
        held_out_synthetic_metrics: { precision: 1, recall: 0.95, f1: 0.97 },
      },
      source: 'Synthetic test scenario',
      limitations: ['Synthetic demonstration—not a validated real-world flood forecast.'],
    })),
  },
}))

vi.mock('./api/client', () => ({
  apiBaseUrl: '',
  ApiError: class ApiError extends Error {},
  arkgridApi: api,
}))

vi.mock('./components/MapView', () => ({
  emptyHazardLayers: {
    citizenReports: false,
    floodRisk: false,
    floodPath: false,
    landslideZones: false,
    affectedPopulation: false,
    lowerRiskLocations: false,
    fictionalResources: false,
  },
  MapView: ({
    center,
    onAreaSelect,
  }: {
    center: [number, number]
    onAreaSelect: (lat: number, lng: number) => void
  }) => (
    <div data-testid="map" data-center={center.join(',')}>
      <button type="button" onClick={() => onAreaSelect(27.7172, 85.324)}>
        Select a map point
      </button>
    </div>
  ),
}))

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
afterEach(() => {
  cleanup()
  if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation)
  else Reflect.deleteProperty(navigator, 'geolocation')
})

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  api.health.mockImplementation(async () => ({ status: 'ok', database: 'sqlite', time: '2026-10-14T00:00:00Z' }))
  api.earthquakes.mockImplementation(async () => ({
    items: [],
    total: 0,
    source_name: 'USGS',
    source_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    data_class: 'external_observation',
    fetched_at: '2026-10-14T00:00:00Z',
    stale: false,
    error: null,
    disclaimer: 'Observations only',
  }))
  api.incidents.mockImplementation(async () => ({ items: [], total: 0 }))
  api.resources.mockImplementation(async () => ({ items: [], total: 0, connected_real_resources: 0, notice: 'fictional demo resources' }))
  api.updateIncident.mockReset()
  api.sourceStatuses.mockImplementation(async () => ({ items: [], checked_at: '2026-10-14T00:00:00Z' }))
  api.syncEmergencyReport.mockClear()
  api.syncEmergencyReport.mockImplementation(async () => ({
    serverId: 'incident-server-1',
    synchronizedAt: '2026-10-14T00:00:00Z',
  }))
  api.floodDemoSimulation.mockClear()
  window.localStorage.removeItem('arkgrid-auto-emergency')
  window.localStorage.removeItem('arkgrid-last-api-success')
})

describe('ArkGrid frontend', () => {
  it('explains each page in plain language and marks the current navigation item', () => {
    render(<App />)

    expect(screen.getByText(/A current summary, important reports, and map/)).toBeInTheDocument()
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(navigation).getAllByRole('button')).toHaveLength(10)
    expect(within(navigation).getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')

    expect(within(navigation).getByRole('button', { name: 'Live monitoring' })).toBeInTheDocument()
    expect(within(navigation).getByRole('button', { name: 'Interactive map' })).toBeInTheDocument()
    fireEvent.click(within(navigation).getByRole('button', { name: 'Emergency Mode' }))

    expect(screen.getByText(/Save a help report on this device and choose how to share it/)).toBeInTheDocument()
    expect(within(navigation).getByRole('button', { name: 'Emergency Mode' })).toHaveAttribute('aria-current', 'page')
    expect(within(navigation).getByRole('button', { name: 'Overview' })).not.toHaveAttribute('aria-current')
  })

  it('loads real-feed monitoring through the backend and keeps the empty state honest', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Live monitoring' }))

    expect(screen.getByRole('heading', { name: 'Live map' })).toBeInTheDocument()
    expect(await screen.findByText(/No USGS observations match the current filters/)).toBeInTheDocument()
    expect(api.earthquakes).toHaveBeenCalledWith(-2)
  })

  it('shows a backend failure without displaying fabricated earthquake events', async () => {
    api.earthquakes.mockImplementation(async () => {
      throw new Error('network unavailable')
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Live monitoring' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('USGS observations could not be loaded.')
    expect(screen.getByLabelText(/USGS observations \(unavailable visible\)/)).toBeInTheDocument()
    expect(screen.queryByText(/M4\.2/)).not.toBeInTheDocument()
    api.earthquakes.mockResolvedValue({
      items: [],
      total: 0,
      source_name: 'USGS',
      source_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      data_class: 'external_observation',
      fetched_at: '2026-10-14T00:00:00Z',
      stale: false,
      error: null,
      disclaimer: 'Observations only',
    })
  })

  it('loads a clearly labelled synthetic flood demo and requests each selected timeline step', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Flood & satellite' }))

    expect(await screen.findByText(/Selected illustrative route:/)).toBeInTheDocument()
    expect(screen.getByText('SIMULATED SCENARIO — NOT A REAL-WORLD FLOOD FORECAST')).toBeInTheDocument()
    expect(screen.getByText(/Real-data mode · not available/)).toBeInTheDocument()
    expect(screen.getByText('Short east-bank demo road', { selector: 'strong' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('slider', { name: 'Forecast timeline' }), { target: { value: '3' } })
    await waitFor(() => expect(api.floodDemoSimulation).toHaveBeenLastCalledWith({
      rainfallMm: 80,
      waterLevelM: 0.5,
      riverLevelM: 1,
      terrainElevationM: 6,
      waterLevelTrendMPerHour: 0.3,
      horizonHours: 6,
      startLatitude: 26.75,
      startLongitude: 87.2,
    }))
  })

  it('does not pretend the flood model is available offline when it is not cached', async () => {
    render(<App />)
    fireEvent(window, new Event('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Flood & satellite' }))

    expect(await screen.findByText(/Offline: the flood model and scenario are not cached/)).toBeInTheDocument()
    expect(api.floodDemoSimulation).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run synthetic scenario' })).toBeDisabled()
  })

  it('loads persisted incidents and filters by location', async () => {
    const incident: Incident = {
      id: 'demo-incident-1',
      idempotency_key: 'demo-incident-1',
      incident_type: 'Medical emergency',
      severity: 'High',
      category: 'Medical assistance',
      message: 'Demo patient needs assessment',
      people_affected: 2,
      assistance_note: '',
      consent_confirmed: false,
      latitude: null,
      longitude: null,
      manual_location: 'Town Center',
      location_source: 'unknown',
      location_accuracy_meters: null,
      location_captured_at: null,
      location_confidence: 'low',
      immediate_life_threat: null,
      medical_urgency: true,
      data_class: 'simulation',
      source: 'test',
      status: 'new',
      created_at: '2026-10-14T00:00:00Z',
      updated_at: '2026-10-14T00:00:00Z',
      internal_notes: [],
      assigned_resource_id: null,
      priority: {
        score: 54,
        band: 'high',
        factors: [{ key: 'severity', points: 20, explanation: 'High reported severity.' }],
        uncertainty: ['Simulation data'],
        explanation: 'Rules-based triage aid.',
        method: 'arkgrid-rules-v1',
        override_reason: null,
      },
    }
    api.incidents.mockImplementation(async () => ({ items: [incident], total: 1 }))
    render(<App />)
    const importantIncidents = screen.getByRole('complementary', { name: 'Important incidents and selected map details' })
    const importantReport = await within(importantIncidents).findByRole('button', { name: /High · Medical emergency/ })
    fireEvent.click(importantReport)
    expect(within(importantIncidents).getByText('Demo patient needs assessment')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Incidents' }))

    expect(await screen.findByText('Demo patient needs assessment')).toBeInTheDocument()
    expect(screen.getByText(/Priority 54\/100/)).toBeInTheDocument()
    api.updateIncident.mockResolvedValue({ ...incident, status: 'triaged' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Update incident status' }), {
      target: { value: 'triaged' },
    })
    await waitFor(() => expect(api.updateIncident).toHaveBeenCalledWith('demo-incident-1', { status: 'triaged' }))
    expect(screen.getByRole('combobox', { name: 'Update incident status' })).toHaveValue('triaged')

    fireEvent.change(screen.getByLabelText('Filter by location'), { target: { value: 'Nowhere' } })
    expect(screen.getByText(/No persisted incidents match these filters/)).toBeInTheDocument()
  })

  it('shows Online only after backend health succeeds and goes Offline immediately on network loss', async () => {
    render(<App />)

    const connectionStatus = screen.getByRole('status', { name: 'Connectivity and backend status' })
    await waitFor(() => expect(connectionStatus).toHaveTextContent('Online'))
    fireEvent(window, new Event('offline'))
    expect(connectionStatus).toHaveTextContent('Offline')
    expect(screen.queryByText(/Browser online|API: Reachable|hint/i)).not.toBeInTheDocument()
  })

  it('stays Offline when the backend health check fails or times out', async () => {
    api.health.mockImplementation(async () => { throw new Error('request timed out') })
    render(<App />)
    expect(await screen.findByRole('status', { name: 'Connectivity and backend status' })).toHaveTextContent('Offline')
    expect(screen.queryByText(/Browser online|API: Reachable|hint/i)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Emergency Mode' })).toHaveLength(2)
  })

  it('ignores an older health result after the browser goes offline', async () => {
    let resolveHealth!: (value: { status: 'ok'; database: 'available'; time: string }) => void
    api.health.mockImplementation(() => new Promise(resolve => { resolveHealth = resolve }))
    render(<App />)
    const connectionStatus = screen.getByRole('status', { name: 'Connectivity and backend status' })

    fireEvent(window, new Event('offline'))
    expect(connectionStatus).toHaveTextContent('Offline')
    resolveHealth({ status: 'ok', database: 'available', time: '2026-10-16T00:00:00Z' })
    await waitFor(() => expect(connectionStatus).toHaveTextContent('Offline'))
  })

  it('opens the browser installation prompt and confirms only the appinstalled event', async () => {
    render(<App />)
    expect(screen.getByText('Installation unavailable in this browser.')).toBeInTheDocument()

    const prompt = vi.fn(async () => undefined)
    const installEvent = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })
    fireEvent(window, installEvent)
    fireEvent.click(screen.getByRole('button', { name: 'Install App' }))
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    expect(screen.getByText('Installation requested; waiting for browser confirmation.')).toBeInTheDocument()
    expect(screen.queryByText('Installed')).not.toBeInTheDocument()

    fireEvent(window, new Event('appinstalled'))
    expect(screen.getByText('Installed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install App' })).not.toBeInTheDocument()
  })

  it('shows the iOS Safari Add to Home Screen instructions when native prompting is unavailable', () => {
    vi.stubGlobal('navigator', {
      onLine: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 0,
    })
    render(<App />)
    expect(screen.getByText('Install: Share → Add to Home Screen')).toBeInTheDocument()
  })

  it('selects the custom map scenario and reports a clicked coordinate', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Live monitoring' }))
    fireEvent.click(screen.getByRole('button', { name: 'Area map' }))

    expect(await screen.findByText(/Map data © OpenStreetMap contributors/i)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Scenario' }), {
      target: { value: 'custom' },
    })
    expect(screen.getByTestId('map')).toHaveAttribute('data-center', '20.59,78.96')

    fireEvent.click(screen.getByRole('button', { name: 'Select a map point' }))
    expect(screen.getByText(/Selected point: 27\.7172, 85\.3240/)).toBeInTheDocument()
  })

  it('validates SOS fields, stores the report locally first, then syncs using its report ID', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Incidents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit demo report' }))

    const submit = screen.getByRole('button', { name: 'Submit SOS report' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Primary need'), {
      target: { value: 'Medical assistance' },
    })
    fireEvent.change(screen.getByLabelText('People affected'), {
      target: { value: '0' },
    })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('People affected'), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText('Location description'), {
      target: { value: 'Demo location' },
    })
    expect(submit).toBeEnabled()

    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(await screen.findByText(/SOS saved on this device/)).toBeInTheDocument()
    await waitFor(() => expect(api.syncEmergencyReport).toHaveBeenCalledOnce())
    const report = await emergencyStorage.listReports().then(items => items[0])
    expect(report).toMatchObject({
      incidentType: 'Medical emergency',
      severity: 'Moderate',
      peopleAffected: 1,
      manualLocation: 'Demo location',
      syncStatus: 'synchronized',
      serverIncidentId: 'incident-server-1',
    })
    expect(api.syncEmergencyReport).toHaveBeenCalledWith(expect.objectContaining({ id: report.id }))
    expect(screen.getByRole('button', { name: 'Review saved report and SMS options' })).toBeInTheDocument()
  })

  it('retains a local SOS when backend synchronization fails', async () => {
    api.syncEmergencyReport.mockRejectedValueOnce(new Error('backend unavailable'))
    api.earthquakes.mockRejectedValueOnce(new Error('feed unavailable'))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Citizen SOS' }))
    fireEvent.change(screen.getByLabelText('Primary need'), { target: { value: 'Evacuation assistance' } })
    fireEvent.change(screen.getByLabelText('People affected'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Location description'), { target: { value: 'Community hall' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit SOS report' }))

    expect(await screen.findByText(/Backend synchronization failed\. The local report remains saved/)).toBeInTheDocument()
    expect(await emergencyStorage.listReports()).toMatchObject([{
      incidentType: 'Evacuation needed',
      category: 'Evacuation',
      syncStatus: 'failed',
      syncAttempts: 1,
    }])
    expect(await screen.findByText(/Hazard information unavailable — manual emergency report retained/)).toBeInTheDocument()
  })

  it('saves SOS locally while offline and retains the pending report for Emergency Mode', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Citizen SOS' }))
    fireEvent.change(screen.getByLabelText('Primary need'), { target: { value: 'Food or water' } })
    fireEvent.change(screen.getByLabelText('People affected'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Location description'), { target: { value: 'Near the river bridge' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit SOS report' }))

    expect(await screen.findByText(/SOS saved on this device — not yet delivered/)).toBeInTheDocument()
    expect((await emergencyStorage.listReports())[0]).toMatchObject({
      incidentType: 'Other urgent need',
      category: 'Food or water',
      peopleAffected: 2,
      manualLocation: 'Near the river bridge',
      syncStatus: 'pending',
    })
    expect(api.syncEmergencyReport).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    fireEvent(window, new Event('online'))
    await waitFor(() => expect(api.syncEmergencyReport).toHaveBeenCalledOnce())
    await waitFor(async () => expect((await emergencyStorage.listReports())[0].syncStatus).toBe('synchronized'))
  })

  it('falls back to a manual location when geolocation permission is denied', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) =>
          failure({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }),
      },
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Citizen SOS' }))
    fireEvent.change(screen.getByLabelText('Primary need'), { target: { value: 'Medical assistance' } })
    fireEvent.change(screen.getByLabelText('People affected'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use current location (optional)' }))
    expect(await screen.findByText(/Location permission was denied/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Location description'), { target: { value: 'Manual address' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit SOS report' }))
    expect(await screen.findByText(/SOS saved on this device/)).toBeInTheDocument()
    expect((await emergencyStorage.listReports())[0]).toMatchObject({
      locationSource: 'manual',
      manualLocation: 'Manual address',
    })
  })

  it('shows a concise situation summary from fetched data instead of fixed counts', async () => {
    api.incidents.mockResolvedValue({ items: [], total: 0 })
    api.earthquakes.mockResolvedValue({
      items: [],
      total: 0,
      source_name: 'USGS',
      source_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      data_class: 'external_observation',
      fetched_at: '2026-10-14T00:00:00Z',
      stale: false,
      error: null,
      disclaimer: 'Observations only',
    })
    render(<App />)

    const activeMetric = await screen.findByText('Open incidents')
    expect(activeMetric.parentElement).toHaveTextContent('0')
    expect(screen.getByText('High-priority incidents').parentElement).toHaveTextContent('0')
    expect(screen.getByText('Earthquake observations').parentElement).toHaveTextContent('0')
    expect(screen.getByText('Pending local reports').parentElement).toHaveTextContent('0')
  })
})
