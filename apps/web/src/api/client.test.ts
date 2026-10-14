import { afterEach, describe, expect, it, vi } from 'vitest'
import { arkgridApi } from './client'
import type { EmergencyReport } from '../emergency/types'

const report: EmergencyReport = {
  id: 'local-report-location-1',
  createdAt: '2026-10-14T05:00:00.000Z',
  serverIncidentId: null,
  syncAttempts: 0,
  incidentType: 'Medical emergency',
  severity: 'Critical',
  category: 'Medical assistance',
  message: 'Need help',
  peopleAffected: 2,
  assistanceNote: '',
  latitude: 27.7172,
  longitude: 85.324,
  manualLocation: '',
  locationSource: 'device',
  locationAccuracyMeters: 450,
  locationCapturedAt: '2026-10-14T05:00:00.000Z',
  transmissionStatus: 'not_started',
  transmissionAttemptedAt: null,
  syncStatus: 'pending',
  syncAttemptedAt: null,
  syncError: null,
}

afterEach(() => vi.unstubAllGlobals())

describe('ArkGrid API client', () => {
  it('rejects an HTTP 200 response that is not a healthy backend payload', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('<!doctype html><title>ArkGrid</title>', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'ok',
        database: 'unavailable',
        time: '2026-10-14T05:01:00.000Z',
      }), { status: 200 })))

    await expect(arkgridApi.health()).rejects.toThrow(/invalid response/)
    await expect(arkgridApi.health()).rejects.toThrow(/invalid response/)
  })

  it('syncs location provenance and only returns after backend acknowledgement', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'ok',
        database: 'available',
        time: '2026-10-14T05:01:00.000Z',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'server-incident-1',
        updated_at: '2026-10-14T05:01:01.000Z',
      }), { status: 201 }))
    vi.stubGlobal('fetch', fetcher)

    await expect(arkgridApi.syncEmergencyReport(report)).resolves.toEqual({
      serverId: 'server-incident-1',
      synchronizedAt: '2026-10-14T05:01:01.000Z',
    })

    const request = fetcher.mock.calls[1]
    expect(request?.[0]).toBe('/api/incidents')
    const init = request?.[1]
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(payload).toMatchObject({
      locationSource: 'device',
      locationAccuracyMeters: 450,
      locationCapturedAt: '2026-10-14T05:00:00.000Z',
      locationConfidence: 'medium',
      dataClass: 'citizen_report',
      consentConfirmed: true,
    })
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(report.id)
  })
})
