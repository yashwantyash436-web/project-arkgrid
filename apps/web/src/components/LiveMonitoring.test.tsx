import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveMonitoring } from './LiveMonitoring'
import type { Earthquake } from '../api/types'

const { api } = vi.hoisted(() => ({
  api: {
    earthquakes: vi.fn(),
  },
}))

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  arkgridApi: api,
}))

vi.mock('./MapView', () => ({
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
    markers,
    earthquakes,
    showEarthquakes,
    center,
    zoom,
    selectedSeismicRegion,
    showRegionBounds,
    onEarthquakeSelect,
    onDemoIncidentSelect,
  }: {
    markers: boolean
    earthquakes: Earthquake[]
    showEarthquakes: boolean
    center: [number, number]
    zoom: number
    selectedSeismicRegion: { name: string } | null
    showRegionBounds: boolean
    onEarthquakeSelect: (event: Earthquake) => void
    onDemoIncidentSelect: (incident: { id: string; title: string; location: string; severity: string; description: string }) => void
  }) => (
    <div data-testid="monitor-map-view" data-center={center.join(',')} data-zoom={zoom}
      data-selected-region={selectedSeismicRegion?.name ?? ''} data-region-bounds={showRegionBounds}>
      <p>Demo markers: {markers ? 'visible' : 'hidden'} · USGS markers: {showEarthquakes ? earthquakes.length : 0}</p>
      {showEarthquakes && earthquakes.map(event => (
        <button key={event.id} type="button" onClick={() => onEarthquakeSelect(event)}>Select map event {event.id}</button>
      ))}
      {markers && <button type="button" onClick={() => onDemoIncidentSelect({
        id: 'SIM-024', title: 'Temporary shelter support request', location: 'Demo area', severity: 'High', description: 'Fixture',
      })}>Select demo map fixture</button>}
    </div>
  ),
}))

afterEach(cleanup)

describe('live map and event list', () => {
  it('toggles only demo markers and connects selecting an event with its details', async () => {
    const observedRecently = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const event: Earthquake = {
      id: 'usgs-test-1',
      magnitude: 4.1,
      place: 'Test region',
      time: observedRecently,
      latitude: 27.7,
      longitude: 85.3,
      depth_km: 18,
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/usgs-test-1',
    }
    api.earthquakes.mockResolvedValue({
      items: [event],
      total: 1,
      source_name: 'USGS Earthquake Hazards Program',
      source_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      data_class: 'external_observation',
      fetched_at: observedRecently,
      stale: false,
      error: null,
      disclaimer: 'Observation only',
    })
    render(<LiveMonitoring center={[27.7, 85.3]} />)

    expect(await screen.findByText('Demo markers: hidden · USGS markers: 1')).toBeInTheDocument()
    expect(screen.getByTestId('monitor-map-view')).toHaveAttribute('data-center', '18,0')
    expect(screen.getByTestId('monitor-map-view')).toHaveAttribute('data-zoom', '2')
    fireEvent.click(screen.getByRole('button', { name: 'Scenario region' }))
    expect(screen.getByTestId('monitor-map-view')).toHaveAttribute('data-center', '28.3,84.5')
    fireEvent.click(screen.getByRole('button', { name: 'Global overview' }))
    fireEvent.click(screen.getByLabelText(/Fictional demo incidents/))
    expect(screen.getByText('Demo markers: visible · USGS markers: 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Select demo map fixture' }))
    expect(screen.getByRole('heading', { name: /Demo fixture · Temporary shelter support request/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Select to inspect the corresponding map marker/ }))
    expect(screen.getByRole('heading', { name: 'Selected USGS observation · M4.1' })).toBeInTheDocument()
    expect(screen.getAllByText(/18 km/)).not.toHaveLength(0)

    fireEvent.change(screen.getByLabelText('Minimum magnitude'), { target: { value: '5' } })
    expect(screen.getByText('Demo markers: visible · USGS markers: 0')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Selected USGS observation · M4.1' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Minimum magnitude'), { target: { value: '0' } })

    fireEvent.click(screen.getByLabelText(/Fictional demo incidents/))
    expect(screen.getByText('Demo markers: hidden · USGS markers: 1')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Demo fixture ·/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Selected USGS observation · M4.1' })).toBeInTheDocument()
  })

  it('filters observations to the selected region and labels its approximate bounds', async () => {
    const recent = Date.now() - 30 * 60 * 1000
    const event = (id: string, place: string, latitude: number, longitude: number): Earthquake => ({
      id,
      magnitude: 4.2,
      place,
      time: new Date(recent).toISOString(),
      latitude,
      longitude,
      depth_km: 10,
      url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,
    })
    api.earthquakes.mockResolvedValue({
      items: [event('japan-1', 'Japan', 38, 141), event('nepal-1', 'Nepal', 28, 85)],
      total: 2,
      source_name: 'USGS Earthquake Hazards Program',
      source_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      data_class: 'external_observation',
      fetched_at: new Date().toISOString(),
      stale: false,
      error: null,
      disclaimer: 'Observation only',
    })
    render(<LiveMonitoring center={[27.7, 85.3]} />)

    expect(await screen.findByText('Demo markers: hidden · USGS markers: 2')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Monitored seismic region'), { target: { value: 'japan' } })
    expect(screen.getByText('Demo markers: hidden · USGS markers: 1')).toBeInTheDocument()
    expect(screen.getByTestId('monitor-map-view')).toHaveAttribute('data-center', '38,141')
    expect(screen.getByTestId('monitor-map-view')).toHaveAttribute('data-selected-region', 'Japan')
    expect(screen.getByText('1 observation in the selected time window')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Show approximate monitored-region bounds'))
    expect(screen.getByTestId('monitor-map-view')).toHaveAttribute('data-region-bounds', 'true')
    expect(screen.getByText(/approximate monitoring bounds/)).toBeInTheDocument()
  })
})
