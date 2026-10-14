import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmergencyMode } from './EmergencyMode'
import type { EmergencyReport, EmergencySettings } from './types'

const { state } = vi.hoisted(() => ({
  state: {
    reports: [] as EmergencyReport[],
    settings: { id: 'settings', trustedContacts: [], lastSyncAt: null } as EmergencySettings,
  },
}))

vi.mock('./storage', () => ({
  emergencyStorage: {
    listReports: vi.fn(async () => [...state.reports]),
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
  },
}))

afterEach(cleanup)

beforeEach(() => {
  state.reports = []
  state.settings = { id: 'settings', trustedContacts: [], lastSyncAt: null }
  vi.stubGlobal('confirm', vi.fn(() => true))
})

function openEmergencyMode(offlineReady = true) {
  render(<EmergencyMode online={false} offlineReady={offlineReady} onPendingChange={vi.fn()} />)
}

describe('offline emergency mode', () => {
  it('saves a report locally before showing the review and SMS action', async () => {
    openEmergencyMode(false)
    await screen.findByText(/Offline reload is not ready yet/)
    fireEvent.change(screen.getByLabelText('Manual location description'), { target: { value: 'Near the clinic' } })
    fireEvent.change(screen.getByLabelText(/Short message/), { target: { value: 'Need urgent help' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device and review' }))

    await screen.findByRole('heading', { name: 'Review saved report' })
    expect(state.reports).toHaveLength(1)
    expect(state.reports[0].id).toBeTruthy()
    expect(state.reports[0].syncStatus).toBe('not_configured')
    expect(screen.getByText(/Nothing has been sent/)).toBeInTheDocument()
    expect(screen.getByText(/Backend synchronization is not configured/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Trusted contacts' }))
    expect(screen.queryByRole('heading', { name: 'Review saved report' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Device queue (1)' }))
    expect(screen.getByRole('heading', { name: 'Review saved report' })).toBeInTheDocument()
  })

  it('requires valid international trusted contacts and keeps Bluetooth unsupported', async () => {
    openEmergencyMode()
    await screen.findByRole('button', { name: /Trusted contacts/ })
    fireEvent.click(screen.getByRole('button', { name: 'Trusted contacts' }))
    fireEvent.change(screen.getByLabelText('Trusted phone numbers'), { target: { value: '4155550123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save contacts on this device' }))
    expect(await screen.findByText(/Use up to five contacts in international E\.164 format/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Trusted phone numbers'), { target: { value: '+14155550123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save contacts on this device' }))
    expect(await screen.findByText(/Trusted contacts saved only on this device/)).toBeInTheDocument()
    expect(screen.getByText('Not yet supported.')).toBeInTheDocument()
  })

  it('opens an SMS handoff only with an explicit action and never labels it delivered', async () => {
    openEmergencyMode()
    await screen.findByRole('button', { name: /Trusted contacts/ })
    fireEvent.click(screen.getByRole('button', { name: 'Trusted contacts' }))
    fireEvent.change(screen.getByLabelText('Trusted phone numbers'), { target: { value: '+14155550123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save contacts on this device' }))
    await screen.findByText(/Trusted contacts saved only on this device/)
    fireEvent.click(screen.getByRole('button', { name: 'New report' }))
    fireEvent.change(screen.getByLabelText('Manual location description'), { target: { value: 'Near the clinic' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device and review' }))
    await screen.findByRole('heading', { name: 'Review saved report' })

    const smsLink = screen.getByRole('link', { name: /Open SMS composer for \+14155550123/ })
    expect(smsLink).toHaveAttribute('href', expect.stringContaining('sms:+14155550123'))
    expect((screen.getByLabelText('SMS message preview') as HTMLTextAreaElement).value).toContain('ARKGRID SOS')
    expect(screen.queryByText(/delivered/i)).not.toBeInTheDocument()

    smsLink.addEventListener('click', event => event.preventDefault())
    fireEvent.click(smsLink)
    await screen.findByRole('button', { name: 'I attempted to send it' })
    fireEvent.click(screen.getByRole('button', { name: 'I attempted to send it' }))
    await waitFor(() => expect(state.reports[0].transmissionStatus).toBe('user_marked_attempted'))
    expect(screen.getByText(/delivery is unconfirmed/)).toBeInTheDocument()
  })
})
