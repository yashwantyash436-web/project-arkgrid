import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

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

describe('ArkGrid frontend', () => {
  it('navigates to monitoring and shows that live observations are not connected', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Live monitoring' }))

    expect(screen.getByRole('heading', { name: 'Live monitoring' })).toBeInTheDocument()
    expect(screen.getByText(/No earthquake events are displayed or fabricated/)).toBeInTheDocument()
  })

  it('uses browser network events as device-connection hints', () => {
    render(<App />)

    const connectionStatus = screen.getByRole('status')
    expect(connectionStatus).toHaveTextContent('Online (browser hint)')
    fireEvent(window, new Event('offline'))
    expect(connectionStatus).toHaveTextContent('Offline (browser hint)')
  })

  it('selects the custom map scenario and reports a clicked coordinate', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Interactive map' }))

    expect(screen.getByText(/map data © OpenStreetMap contributors/)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Scenario' }), {
      target: { value: 'custom' },
    })
    expect(screen.getByTestId('map')).toHaveAttribute('data-center', '20.59,78.96')

    fireEvent.click(screen.getByRole('button', { name: 'Select a map point' }))
    expect(screen.getByText(/Custom point: 27\.717, 85\.324/)).toBeInTheDocument()
  })

  it('requires a positive whole number before validating a simulated SOS', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Citizen SOS' }))

    const submit = screen.getByRole('button', { name: 'Validate simulated SOS' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Name or identifier'), {
      target: { value: 'Demo participant' },
    })
    fireEvent.change(screen.getByLabelText('Safe contact method'), {
      target: { value: 'Demo contact only' },
    })
    fireEvent.change(screen.getByLabelText('Primary need'), {
      target: { value: 'Food or water' },
    })
    fireEvent.change(screen.getByLabelText('People affected'), {
      target: { value: '0' },
    })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('People affected'), {
      target: { value: '1' },
    })
    expect(submit).toBeEnabled()

    fireEvent.click(submit)
    expect(screen.getByText(/No report was transmitted/)).toBeInTheDocument()
  })
})
