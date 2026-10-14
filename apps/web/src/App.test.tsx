import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
