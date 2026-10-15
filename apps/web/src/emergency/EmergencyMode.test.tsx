import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmergencyMode } from './EmergencyMode'
import { emergencyStorage } from './storage'
import type { EmergencyReport, EmergencySettings } from './types'

const { state } = vi.hoisted(() => ({
  state: {
    reports: [] as EmergencyReport[],
    settings: { id: 'settings', emergencyRegion: '', trustedContacts: [], lastSyncAt: null, recentLocation: null } as EmergencySettings,
    listReports: vi.fn(async () => [...state.reports]),
    sync: vi.fn(async () => ({ serverId: 'incident-server-1', synchronizedAt: '2026-10-14T00:00:00Z' })),
    suggestCategory: vi.fn(async () => ({ category: 'Rescue' as const, score: 0.84, model: 'demo_multinomial_naive_bayes' })),
  },
}))

vi.mock('../api/client', () => ({
  apiBaseUrl: '',
  ApiError: class ApiError extends Error {},
  arkgridApi: {
    syncEmergencyReport: state.sync,
    suggestCategory: state.suggestCategory,
  },
}))

vi.mock('./storage', () => ({
  emergencyStorage: {
    listReports: state.listReports,
    getSettings: vi.fn(async () => ({ ...state.settings })),
    saveReport: vi.fn(async (report: EmergencyReport) => {
      state.reports = [report, ...state.reports.filter(item => item.id !== report.id)]
    }),
    deleteReport: vi.fn(async (id: string) => {
      state.reports = state.reports.filter(item => item.id !== id)
    }),
    saveSettings: vi.fn(async (settings: EmergencySettings) => {
      state.settings = settings
    }),
    updateSettings: vi.fn(async (update: (settings: EmergencySettings) => EmergencySettings) => {
      state.settings = update(state.settings)
      return state.settings
    }),
  },
}))

const originalGeolocationDescriptor = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  cleanup()
  if (originalGeolocationDescriptor) {
    Object.defineProperty(navigator, 'geolocation', originalGeolocationDescriptor)
  } else {
    Reflect.deleteProperty(navigator, 'geolocation')
  }
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

beforeEach(() => {
  state.reports = []
  state.settings = { id: 'settings', emergencyRegion: '', trustedContacts: [], lastSyncAt: null, recentLocation: null }
  state.listReports.mockImplementation(async () => [...state.reports])
  state.sync.mockClear()
  state.suggestCategory.mockClear()
  vi.mocked(emergencyStorage.updateSettings).mockImplementation(async update => {
    state.settings = update(state.settings)
    return state.settings
  })
  vi.stubGlobal('confirm', vi.fn(() => true))
})

function openEmergencyMode(offlineReady = true) {
  render(<EmergencyMode online={false} offlineReady={offlineReady} onPendingChange={vi.fn()} />)
}

describe('offline emergency mode', () => {
  it('offers a demo ML category suggestion for review before applying it', async () => {
    openEmergencyMode()
    await screen.findByRole('button', { name: /Trusted contacts/ })
    fireEvent.change(screen.getByLabelText(/Short message/), {
      target: { value: 'We are trapped under rubble and need rescue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Suggest category from message' }))

    expect(await screen.findByRole('button', { name: 'Use suggestion' })).toBeInTheDocument()
    expect(state.suggestCategory).toHaveBeenCalledWith('We are trapped under rubble and need rescue')
    const category = screen.getByLabelText('Emergency category') as HTMLSelectElement
    expect(category.value).toBe('Medical assistance')

    fireEvent.click(screen.getByRole('button', { name: 'Use suggestion' }))
    expect(category.value).toBe('Rescue')
  })

  it('saves a report locally before showing the review and SMS action', async () => {
    openEmergencyMode(false)
    await screen.findByText(/Offline reload is not ready yet/)
    fireEvent.change(screen.getByLabelText('Manual location description'), { target: { value: 'Near the clinic' } })
    fireEvent.change(screen.getByLabelText(/Short message/), { target: { value: 'Need urgent help' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device and review' }))

    await screen.findByRole('heading', { name: 'Review saved report' })
    expect(state.reports).toHaveLength(1)
    expect(state.reports[0].id).toBeTruthy()
    expect(state.reports[0].syncStatus).toBe('pending')
    expect(screen.getByText(/Nothing has been sent/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Trusted contacts' }))
    expect(screen.queryByRole('heading', { name: 'Review saved report' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Device queue (1)' }))
    expect(screen.getByRole('heading', { name: 'Review saved report' })).toBeInTheDocument()
    expect(screen.getByText(/Ready to synchronize with the configured backend/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to queue' }))
    expect(screen.getByText(/Manual sync first checks backend health/)).toBeInTheDocument()
  })

  it('stores the user-entered emergency region without suggesting a local number', async () => {
    openEmergencyMode()
    await screen.findByRole('button', { name: /Trusted contacts/ })
    fireEvent.click(screen.getByRole('button', { name: 'Trusted contacts' }))
    fireEvent.change(screen.getByLabelText(/Your country \/ region/), {
      target: { value: 'New Zealand' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save region' }))

    await waitFor(() => expect(state.settings.emergencyRegion).toBe('New Zealand'))
    expect(screen.getByText(/does not look up or recommend an emergency number/)).toBeInTheDocument()
  })

  it('captures device coordinates with the browser-reported accuracy and timestamp', async () => {
    const capturedAt = Date.parse('2026-10-14T05:00:00.000Z')
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({
      coords: {
        latitude: 27.7172,
        longitude: 85.324,
        accuracy: 42,
      } as GeolocationCoordinates,
      timestamp: capturedAt,
    } as GeolocationPosition))
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
    openEmergencyMode()
    await screen.findByRole('button', { name: /Trusted contacts/ })

    fireEvent.click(screen.getByRole('button', { name: 'Use this device’s location' }))
    expect(await screen.findByText(/Browser-reported accuracy: ±42 m/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device and review' }))

    await screen.findByRole('heading', { name: 'Review saved report' })
    expect(state.reports[0]).toMatchObject({
      latitude: 27.7172,
      longitude: 85.324,
      locationSource: 'device',
      locationAccuracyMeters: 42,
      locationCapturedAt: '2026-10-14T05:00:00.000Z',
    })
    expect(screen.getByRole('link', { name: 'View reported coordinates on OpenStreetMap' }))
      .toHaveAttribute('href', expect.stringContaining('mlat=27.7172'))
  })

  it('keeps report creation available when location permission is denied', async () => {
    const denied = {
      code: 1,
      message: 'Permission denied',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) => error(denied) },
    })
    openEmergencyMode()
    await screen.findByRole('button', { name: /Trusted contacts/ })
    fireEvent.click(screen.getByRole('button', { name: 'Use this device’s location' }))
    expect(await screen.findByText(/Location permission was not granted/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Manual location description'), { target: { value: 'Location withheld' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device and review' }))
    await screen.findByRole('heading', { name: 'Review saved report' })
    expect(state.reports[0]).toMatchObject({ latitude: null, longitude: null, locationSource: 'unknown' })
  })

  it('labels manually entered coordinates as unverified and validates coordinate bounds', async () => {
    openEmergencyMode()
    await screen.findByRole('button', { name: /Trusted contacts/ })
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '27.7' } })
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '85.3' } })
    expect(screen.getByText('Manually entered coordinates; not device-verified.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device and review' }))
    await screen.findByRole('heading', { name: 'Review saved report' })
    expect(state.reports[0].locationSource).toBe('manual')
    expect(state.reports[0].locationAccuracyMeters).toBeNull()
  })

  it('requires valid international trusted contacts and keeps Bluetooth unsupported', async () => {
    openEmergencyMode()
    await screen.findByRole('button', { name: /Trusted contacts/ })
    fireEvent.click(screen.getByRole('button', { name: 'Trusted contacts' }))
    fireEvent.change(screen.getByLabelText('Contact name'), { target: { value: 'Alex' } })
    fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'Sibling' } })
    fireEvent.change(screen.getByLabelText('Phone number (international format)'), { target: { value: '4155550123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add trusted contact' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid international phone number/)

    fireEvent.change(screen.getByLabelText('Phone number (international format)'), { target: { value: '+14155550123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add trusted contact' }))
    expect(await screen.findByText(/Contact saved only on this device/)).toBeInTheDocument()
    expect(state.settings.trustedContacts[0]).toMatchObject({ name: 'Alex', relationship: 'Sibling', phone: '+14155550123' })
    expect(screen.getByText('+14155550123')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add trusted contact' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Save contact changes' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Contact name'), { target: { value: 'Alexandra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save contact changes' }))
    await waitFor(() => expect(state.settings.trustedContacts[0].name).toBe('Alexandra'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(state.settings.trustedContacts).toHaveLength(0))
    expect(screen.getByText(/Bluetooth SOS relay is not implemented/)).toBeInTheDocument()
  })

  it('keeps saved contacts available when a separate report-store read fails', async () => {
    state.settings.trustedContacts = [{
      id: 'saved-contact',
      name: 'Asha',
      relationship: 'Sister',
      phone: '+9779812345678',
      note: '',
    }]
    state.listReports.mockRejectedValueOnce(new Error('report store unavailable'))
    openEmergencyMode()
    fireEvent.click(await screen.findByRole('button', { name: /Trusted contacts/ }))

    expect(await screen.findByText('Asha')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/Existing records have not been deleted/)
    expect(screen.getByRole('button', { name: 'Add trusted contact' })).toBeEnabled()
  })

  it('shows a storage error rather than claiming a contact was saved', async () => {
    vi.mocked(emergencyStorage.updateSettings).mockRejectedValueOnce(new Error('quota exceeded'))
    openEmergencyMode()
    fireEvent.click(await screen.findByRole('button', { name: /Trusted contacts/ }))
    fireEvent.change(screen.getByLabelText('Contact name'), { target: { value: 'Asha' } })
    fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'Sister' } })
    fireEvent.change(screen.getByLabelText('Phone number (international format)'), { target: { value: '+9779812345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add trusted contact' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not save this contact/)
    expect(screen.queryByText(/Contact saved only on this device/)).not.toBeInTheDocument()
    expect(state.settings.trustedContacts).toHaveLength(0)
  })

  it('opens an SMS handoff only with an explicit action and never labels it delivered', async () => {
    openEmergencyMode()
    await screen.findByRole('button', { name: /Trusted contacts/ })
    fireEvent.click(screen.getByRole('button', { name: 'Trusted contacts' }))
    fireEvent.change(screen.getByLabelText('Contact name'), { target: { value: 'Alex' } })
    fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'Friend' } })
    fireEvent.change(screen.getByLabelText('Phone number (international format)'), { target: { value: '+14155550123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add trusted contact' }))
    await screen.findByText(/Contact saved only on this device/)
    fireEvent.click(screen.getByRole('button', { name: 'New report' }))
    fireEvent.change(screen.getByLabelText('Manual location description'), { target: { value: 'Near the clinic' } })
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '27.7' } })
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '85.3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device and review' }))
    await screen.findByRole('heading', { name: 'Review saved report' })

    fireEvent.click(screen.getByRole('checkbox', { name: /Alex/ }))
    const includeLocation = screen.getByRole('checkbox', { name: /Include location details, coordinates and map link/ })
    expect((screen.getByLabelText('SMS message for Alex') as HTMLTextAreaElement).value).not.toContain('27.70000')
    fireEvent.click(includeLocation)
    const smsLink = screen.getByRole('link', { name: /Prepare SMS for Alex/ })
    expect(smsLink).toHaveAttribute('href', expect.stringContaining('sms:+14155550123'))
    expect((screen.getByLabelText('SMS message for Alex') as HTMLTextAreaElement).value).toContain('ARKGRID SOS')
    expect((screen.getByLabelText('SMS message for Alex') as HTMLTextAreaElement).value).toContain('27.70000,85.30000')
    expect((screen.getByLabelText('SMS message for Alex') as HTMLTextAreaElement).value).toContain('https://www.openstreetmap.org')
    expect(screen.getByText(/Saved locally on this device/)).toBeInTheDocument()
    expect(screen.queryByText(/SMS was delivered/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('SMS message for Alex'), { target: { value: 'Please call me & bring water.' } })
    const editedSmsLink = screen.getByRole('link', { name: /Prepare SMS for Alex/ })
    expect(editedSmsLink.getAttribute('href')).toContain(encodeURIComponent('Please call me & bring water.'))
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy message instead' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Please call me & bring water.'))
    expect(await screen.findByRole('status')).toHaveTextContent('Message copied. Paste it into your messaging app')

    editedSmsLink.addEventListener('click', event => event.preventDefault())
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    fireEvent.click(editedSmsLink)
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Please call me & bring water.'))
    expect(screen.getByText('SMS handoff cancelled. No message was sent.')).toBeInTheDocument()

    fireEvent.click(editedSmsLink)
    await waitFor(() => expect(state.reports[0].transmissionStatus).toBe('handoff_requested'))
    expect(screen.getByText(/whether a composer opened and whether a message was sent are unknown/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'I cancelled / no SMS app opened' }))
    await waitFor(() => expect(state.reports[0].transmissionStatus).toBe('handoff_failed'))
    expect(screen.getByText(/SMS handoff was cancelled or unavailable/)).toBeInTheDocument()

    fireEvent.click(smsLink)
    await screen.findByRole('button', { name: 'I sent it (unverified)' })
    fireEvent.click(screen.getByRole('button', { name: 'I sent it (unverified)' }))
    await waitFor(() => expect(state.reports[0].transmissionStatus).toBe('user_marked_attempted'))
    expect(screen.getByText(/delivery status is unknown/)).toBeInTheDocument()
  })

  it('stores only the latest explicitly captured location and can delete it', async () => {
    const timestamp = Date.now()
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (success: PositionCallback) => success({
        coords: { latitude: 27.7, longitude: 85.3, accuracy: 16 } as GeolocationCoordinates,
        timestamp,
      } as GeolocationPosition) },
    })
    openEmergencyMode()
    await screen.findByRole('button', { name: /Trusted contacts/ })
    fireEvent.click(screen.getByRole('button', { name: 'Trusted contacts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enable Location / refresh' }))
    expect(await screen.findByText(/Last captured location — not live tracking/)).toBeInTheDocument()
    expect(state.settings.recentLocation).toMatchObject({ latitude: 27.7, accuracyMeters: 16 })
    fireEvent.click(screen.getByRole('button', { name: 'Delete recent location' }))
    await waitFor(() => expect(state.settings.recentLocation).toBeNull())
  })

  it('marks a local report synchronized only after the API acknowledges it', async () => {
    openEmergencyMode()
    await screen.findByRole('button', { name: /Trusted contacts/ })
    fireEvent.change(screen.getByLabelText('Manual location description'), { target: { value: 'Demo location' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device and review' }))
    await screen.findByRole('heading', { name: 'Review saved report' })
    fireEvent.click(screen.getByRole('button', { name: 'Device queue (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sync pending (1)' }))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('shares their report details and location'))
    await waitFor(() => expect(state.sync).toHaveBeenCalledWith(expect.objectContaining({ id: state.reports[0].id })))
    await waitFor(() => expect(state.reports[0].syncStatus).toBe('synchronized'))
    expect(state.reports[0].serverIncidentId).toBe('incident-server-1')
    expect(state.reports[0].syncAttempts).toBe(1)
    expect(screen.getByText(/Backend acknowledged persistence/)).toBeInTheDocument()
  })
})
