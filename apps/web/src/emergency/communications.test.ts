import { describe, expect, it, vi } from 'vitest'
import {
  createBackendSyncProvider,
  formatSmsMessage,
  isLikelyMultipartSms,
  mapSyncError,
  normalizePhoneNumber,
  smsHandoffProvider,
} from './communications'
import type { EmergencyReport } from './types'

const report: EmergencyReport = {
  id: 'arkgrid-report-123',
  createdAt: '2026-10-14T05:00:00.000Z',
  serverIncidentId: null,
  syncAttempts: 0,
  incidentType: 'Medical emergency',
  severity: 'Critical',
  category: 'Medical assistance',
  message: 'Need urgent help',
  peopleAffected: 2,
  assistanceNote: 'Needs wheelchair access',
  latitude: 27.7172,
  longitude: 85.324,
  manualLocation: 'Near the clinic',
  locationSource: 'device',
  locationAccuracyMeters: 25,
  locationCapturedAt: '2026-10-14T05:00:00.000Z',
  transmissionStatus: 'not_started',
  transmissionAttemptedAt: null,
  syncStatus: 'pending',
  syncAttemptedAt: null,
  syncError: null,
}

describe('SMS and synchronization providers', () => {
  it('accepts only international E.164 numbers', () => {
    expect(normalizePhoneNumber('+1 (415) 555-0123')).toBe('+14155550123')
    expect(normalizePhoneNumber('4155550123')).toBeNull()
    expect(normalizePhoneNumber('+0123456789')).toBeNull()
    expect(normalizePhoneNumber('+1234567890123456')).toBeNull()
  })

  it('includes report identity, type, severity, location, time, and message in the SMS', () => {
    const message = formatSmsMessage(report)

    expect(message).toContain(report.id)
    expect(message).toContain('Critical Medical emergency')
    expect(message).toContain('27.71720,85.32400 / Near the clinic')
    expect(message).toContain(report.createdAt)
    expect(message).toContain(report.message)
    expect(smsHandoffProvider.createHref('+14155550123', message)).toContain('sms:+14155550123?body=')
    expect(isLikelyMultipartSms('x'.repeat(161))).toBe(true)
    expect(isLikelyMultipartSms('x'.repeat(160))).toBe(false)
  })

  it('uses the client report ID as the backend idempotency key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'server-1' }), { status: 201 }),
    )
    const provider = createBackendSyncProvider('https://api.example.test/', fetcher)

    await expect(provider.sync(report)).resolves.toEqual({
      serverId: 'server-1',
      synchronizedAt: expect.any(String),
    })
    expect(fetcher).toHaveBeenCalledWith('https://api.example.test/api/incidents', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': report.id }),
    }))
  })

  it('does not claim success when the backend is unavailable or rejects a report', async () => {
    await expect(createBackendSyncProvider(undefined).sync(report))
      .rejects.toThrow('Backend synchronization is not configured')

    const provider = createBackendSyncProvider('https://api.example.test', vi.fn<typeof fetch>().mockResolvedValue(
      new Response('unavailable', { status: 503 }),
    ))
    await expect(provider.sync(report)).rejects.toThrow('HTTP 503')
    expect(mapSyncError(new Error('network down'))).toContain('remains saved on this device')
  })
})
