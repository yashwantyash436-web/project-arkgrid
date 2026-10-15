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
  it('validates the live earthquake response and sends an explicit refresh query', async () => {
    const response = {
      items: [{
        id: 'usgs-event-1',
        magnitude: 4.2,
        place: 'Japan',
        time: '2026-10-14T05:00:00.000Z',
        latitude: 38,
        longitude: 141,
        depth_km: 12,
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/usgs-event-1',
      }],
      total: 1,
      source_name: 'USGS Earthquake Hazards Program',
      source_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      data_class: 'external_observation',
      fetched_at: '2026-10-14T05:00:00.000Z',
      stale: false,
      error: null,
      cache_age_seconds: 0,
      disclaimer: 'Recent observations only.',
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    await expect(arkgridApi.earthquakes(-2, true)).resolves.toMatchObject({ total: 1, items: response.items })
    expect(new URL(String(fetcher.mock.calls[0]?.[0]), 'https://arkgrid.test').searchParams.get('refresh')).toBe('true')
  })

  it('rejects malformed earthquake coordinates instead of treating them as valid observations', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      items: [{
        id: 'malformed-event',
        magnitude: 4,
        place: 'Japan',
        time: '2026-10-14T05:00:00.000Z',
        latitude: 91,
        longitude: 141,
        depth_km: 10,
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/malformed-event',
      }],
      total: 1,
      source_name: 'USGS',
      source_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      data_class: 'external_observation',
      fetched_at: '2026-10-14T05:00:00.000Z',
      stale: false,
      error: null,
      disclaimer: 'Observations only',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    await expect(arkgridApi.earthquakes()).rejects.toThrow(/invalid response/)
  })

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

  it('treats a timed-out backend health request as a failed check', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      }))
      vi.stubGlobal('fetch', fetcher)

      const healthCheck = arkgridApi.health()
      const rejection = expect(healthCheck).rejects.toThrow(/timed out/)
      await vi.advanceTimersByTimeAsync(4000)
      await rejection
    } finally {
      vi.useRealTimers()
    }
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

  it('requests an optional category suggestion from report text', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      category: 'Rescue',
      score: 0.84,
      model: 'demo_multinomial_naive_bayes',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    await expect(arkgridApi.suggestCategory('We are trapped and need rescue')).resolves.toMatchObject({
      category: 'Rescue',
      model: 'demo_multinomial_naive_bayes',
    })
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/ml/category-suggestion')
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      text: 'We are trapped and need rescue',
    })
  })
})
