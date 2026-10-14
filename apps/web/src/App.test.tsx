import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Incident, ResourceResponse } from './api/types'

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
    sourceStatuses: vi.fn(async () => ({ items: [], checked_at: '2026-10-14T00:00:00Z' })),
    createIncident: vi.fn(async () => ({ id: 'incident-demo-1' })),
    floodDemoSimulation: vi.fn(async () => ({
      scenario_id: 'koshi-synthetic-demo',
      data_mode: 'DEMO SIMULATION' as const,
      risk_class: 'low' as const,
      horizon_hours: 0 as const,
      inputs: { rainfall_mm: 80, water_level_m: 0.5, river_level_m: 1, terrain_elevation_m: 6, water_level_trend_m_per_hour: 0.3 },
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

afterEach(cleanup)

beforeEach(() => {
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
  api.sourceStatuses.mockImplementation(async () => ({ items: [], checked_at: '2026-10-14T00:00:00Z' }))
  api.createIncident.mockImplementation(async () => ({ id: 'incident-demo-1' }))
  api.floodDemoSimulation.mockClear()
  window.localStorage.removeItem('arkgrid-auto-emergency')
  window.localStorage.removeItem('arkgrid-last-api-success')
})

describe('ArkGrid frontend', () => {
  it('loads real-feed monitoring through the backend and keeps the empty state honest', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Live monitoring' }))

    expect(screen.getByRole('heading', { name: 'Live monitoring' })).toBeInTheDocument()
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
    expect(screen.getByText(/Synthetic demonstration—not a validated real-world flood forecast/)).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Incidents' }))

    expect(await screen.findByText('Demo patient needs assessment')).toBeInTheDocument()
    expect(screen.getByText(/Priority 54\/100/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter by location'), { target: { value: 'Nowhere' } })
    expect(screen.getByText(/No persisted incidents match these filters/)).toBeInTheDocument()
  })

  it('uses browser network events as device-connection hints', () => {
    render(<App />)

    const connectionStatus = screen.getByText('Browser online (hint)').closest('[role="status"]')
    expect(connectionStatus).not.toBeNull()
    expect(connectionStatus).toHaveTextContent('Browser online (hint)')
    fireEvent(window, new Event('offline'))
    expect(connectionStatus).toHaveTextContent('Browser offline (hint)')
    expect(screen.getByText('API: Unavailable')).toBeInTheDocument()
  })

  it('checks API reachability separately from the browser online signal', async () => {
    api.health.mockImplementation(async () => { throw new Error('API connection refused') })
    render(<App />)
    expect(await screen.findByText('API: Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Browser online (hint)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Emergency Mode' })).toBeInTheDocument()
  })

  it('selects the custom map scenario and reports a clicked coordinate', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Interactive map' }))

    expect(screen.getByText(/Map data © OpenStreetMap contributors/i)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Scenario' }), {
      target: { value: 'custom' },
    })
    expect(screen.getByTestId('map')).toHaveAttribute('data-center', '20.59,78.96')

    fireEvent.click(screen.getByRole('button', { name: 'Select a map point' }))
    expect(screen.getByText(/Selected point: 27\.7172, 85\.3240/)).toBeInTheDocument()
  })

  it('requires a location and positive people count before submitting a demo SOS to the API', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Citizen SOS' }))

    const submit = screen.getByRole('button', { name: 'Submit demo report to backend' })
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
    expect(await screen.findByText(/was acknowledged and persisted by the ArkGrid backend/)).toBeInTheDocument()
    expect(api.createIncident).toHaveBeenCalledWith(expect.objectContaining({
      dataClass: 'simulation',
      manualLocation: 'Demo location',
    }), expect.any(String))
  })

  it('shows command-centre metrics from fetched data instead of fixed counts', async () => {
    api.incidents.mockResolvedValue({ items: [], total: 0 })
    api.resources.mockResolvedValue({
      items: [{
        id: 'SIM-RES-TEST',
        name: 'Demo resource',
        capabilities: [],
        location: 'Demo depot',
        latitude: null,
        longitude: null,
        is_simulated: true,
        available: true,
        assigned_incident_id: null,
      }],
      total: 1,
      connected_real_resources: 0,
      notice: 'Fictional fixtures only',
    })
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

    const activeMetric = await screen.findByText('Active incidents')
    expect(activeMetric.parentElement).toHaveTextContent('0')
    expect(screen.getByText('New / unreviewed').parentElement).toHaveTextContent('0')
    expect(screen.getByText('Available demo resources').parentElement).toHaveTextContent('1')
    expect(screen.getByText('Confirmed responder dispatches').parentElement).toHaveTextContent('Not available')
  })
})
