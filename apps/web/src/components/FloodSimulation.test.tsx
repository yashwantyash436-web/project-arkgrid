import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FloodSimulation } from './FloodSimulation'
import type { FloodSimulationResponse } from '../api/types'

const { api } = vi.hoisted(() => ({
  api: {
    floodDemoSimulation: vi.fn(),
    earthquakes: vi.fn(),
    incidents: vi.fn(),
  },
}))

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  arkgridApi: api,
}))

vi.mock('./HazardScenarioMap', async () => {
  const React = await import('react')
  return {
    HazardScenarioMap: (props: {
      layers: Record<string, boolean>
      landslidePath: [number, number][]
      onSourceSelect: (point: [number, number]) => void
      onFeatureSelect: (feature: { id: string; label: string; description: string; latitude: number; longitude: number }) => void
    }) => React.createElement('div', {
      'data-testid': 'scenario-map',
      'data-layers': JSON.stringify(props.layers),
      'data-landslide-path': JSON.stringify(props.landslidePath),
    },
    React.createElement('button', {
      type: 'button',
      onClick: () => props.onSourceSelect([27.1, 86.9]),
    }, 'Select map source'),
    React.createElement('button', {
      type: 'button',
      onClick: () => props.onFeatureSelect({
        id: 'settlement-1',
        label: 'Simulated settlement · Koshi demo settlement A',
        description: '420 illustrative people · intersects this demonstration corridor. This is fictional data.',
        latitude: 26.715,
        longitude: 87.245,
      }),
    }, 'Inspect fictional settlement')),
  }
})

const scenario: FloodSimulationResponse = {
  scenario_id: 'koshi-synthetic-demo',
  data_mode: 'DEMO SIMULATION',
  risk_class: 'high',
  horizon_hours: 0,
  inputs: {
    rainfall_mm: 80,
    water_level_m: 0.5,
    river_level_m: 1,
    terrain_elevation_m: 6,
    water_level_trend_m_per_hour: 0.3,
    start_latitude: 26.75,
    start_longitude: 87.2,
  },
  start_location: { latitude: 26.75, longitude: 87.2 },
  propagation_path: [[26.75, 87.2], [26.715, 87.245], [26.68, 87.29], [26.645, 87.335]],
  cells: [{
    id: 'cell-0-0',
    latitude: 26.75,
    longitude: 87.2,
    elevation_m: 8,
    risk_score: 0.82,
    risk_class: 'high',
  }],
  timeline: [
    { hour: 0, high_risk_cells: 1, moderate_or_high_cells: 1 },
    { hour: 1, high_risk_cells: 1, moderate_or_high_cells: 1 },
    { hour: 3, high_risk_cells: 1, moderate_or_high_cells: 1 },
    { hour: 6, high_risk_cells: 1, moderate_or_high_cells: 1 },
  ],
  routes: [{
    id: 'demo-road',
    label: 'Illustrative demo road',
    geometry: [[26.7, 87.2], [26.8, 87.3]],
    distance_km: 4.2,
    mean_exposure_score: 0.2,
    high_risk_segments: 0,
    illustrative_route_score: 0.45,
  }],
  selected_route_id: 'demo-road',
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
}

afterEach(cleanup)

beforeEach(() => {
  api.floodDemoSimulation.mockReset().mockResolvedValue(scenario)
  api.earthquakes.mockReset().mockResolvedValue({ items: [], total: 0 })
  api.incidents.mockReset().mockResolvedValue({ items: [], total: 0 })
  vi.stubGlobal('confirm', vi.fn(() => true))
})

describe('flood and landslide demonstration controls', () => {
  it('renders a legend and consistent synthetic scenario layers, source selection, and affected-location details', async () => {
    render(<FloodSimulation online />)
    await screen.findByText(/Selected illustrative route:/)

    expect(screen.getByText('SIMULATED SCENARIO — NOT A REAL-WORLD FLOOD FORECAST')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Scenario map legend' })).toHaveTextContent('Red')
    expect(screen.getByRole('group', { name: 'Scenario map legend' })).toHaveTextContent('Orange')
    expect(screen.getByRole('group', { name: 'Scenario map legend' })).toHaveTextContent('Teal')
    expect(screen.getByRole('heading', { name: 'Potentially affected demo settlements' })).toBeInTheDocument()
    expect(screen.getByText(/estimated 1,410 illustrative people/)).toBeInTheDocument()

    const map = screen.getByTestId('scenario-map')
    expect(JSON.parse(map.getAttribute('data-layers') ?? '{}')).toMatchObject({
      floodRisk: true,
      floodPath: true,
      landslideZones: false,
    })
    fireEvent.click(screen.getByLabelText('Synthetic flood-risk heat layer'))
    expect(JSON.parse(map.getAttribute('data-layers') ?? '{}').floodRisk).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect fictional settlement' }))
    expect(screen.getByRole('region', { name: 'Selected map detail' })).toHaveTextContent('420 illustrative people')

    fireEvent.click(screen.getByRole('button', { name: 'Choose starting point on map' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select map source' }))
    expect(screen.getByText('27.1000, 86.9000')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run synthetic scenario' }))
    await waitFor(() => expect(api.floodDemoSimulation).toHaveBeenLastCalledWith(expect.objectContaining({
      startLatitude: 27.1,
      startLongitude: 86.9,
    })))
  })

  it('keeps the landslide scenario separate and recalculates its synthetic inputs', async () => {
    render(<FloodSimulation online />)
    await screen.findByText(/Selected illustrative route:/)
    fireEvent.click(screen.getByRole('tab', { name: 'Landslide scenario · synthetic rule' }))

    expect(screen.getByText('SIMULATED LANDSLIDE SCENARIO — DEMONSTRATION ONLY')).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('scenario-map').getAttribute('data-layers') ?? '{}')).toMatchObject({
      floodRisk: false,
      floodPath: false,
      landslideZones: true,
    })
    const before = screen.getByTestId('scenario-map').getAttribute('data-landslide-path')
    fireEvent.change(screen.getByLabelText('Slope category'), { target: { value: 'gentle' } })
    expect(screen.getByTestId('scenario-map').getAttribute('data-landslide-path')).not.toBe(before)
    fireEvent.change(screen.getByLabelText('Soil condition'), { target: { value: 'saturated' } })
    expect(screen.getByText(/Synthetic rule score:/)).toBeInTheDocument()
  })

  it('reviews and confirms only a local demo alert, then logs that no SMS was sent', async () => {
    render(<FloodSimulation online />)
    await screen.findByText(/Selected illustrative route:/)
    fireEvent.click(screen.getByRole('button', { name: 'Review proposed demo alert' }))

    expect(screen.getByText(/Affected synthetic locations: 3 · illustrative people: 1,410/)).toBeInTheDocument()
    expect(screen.getByText(/DEMO ALERT: A simulated flood scenario/)).toBeInTheDocument()
    expect(screen.getByText(/DEMO-PHONE-001 \(fictional, not dialable\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm demo alert generation' }))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('No phone number will be dialed'))
    expect(screen.getByRole('list', { name: 'Simulated alert activity log' })).toHaveTextContent('No SMS sent; delivery is not applicable.')
  })

  it('surfaces unavailable USGS data instead of manufacturing observations', async () => {
    api.earthquakes.mockRejectedValueOnce(new Error('feed offline'))
    render(<FloodSimulation online />)
    await screen.findByText(/Selected illustrative route:/)
    fireEvent.click(screen.getByLabelText('USGS earthquake observations'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/USGS data unavailable or stale/)
    expect(screen.getByText(/No new observations are fabricated/)).toBeInTheDocument()
  })
})
