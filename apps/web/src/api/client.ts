import type { EmergencyCategory, EmergencyReport } from '../emergency/types'
import type {
  EarthquakeResponse,
  FloodSimulationInput,
  FloodSimulationResponse,
  Incident,
  PriorityAssessment,
  Resource,
  ResourceResponse,
  SourceStatus,
} from './types'

const configuredBaseUrl = import.meta.env.VITE_ARKGRID_API_URL?.trim().replace(/\/+$/, '')
export const apiBaseUrl = configuredBaseUrl ?? ''

export class ApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type HealthResponse = { status: 'ok'; database: 'available'; time: string }

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false
  if (!('status' in value) || value.status !== 'ok') return false
  if (!('database' in value) || value.database !== 'available') return false
  return 'time' in value && typeof value.time === 'string' && Number.isFinite(Date.parse(value.time))
}

function isEarthquakeResponse(value: unknown): value is EarthquakeResponse {
  if (typeof value !== 'object' || value === null || !('items' in value) || !Array.isArray(value.items)) return false
  if (!('total' in value) || value.total !== value.items.length) return false
  if (!('source_name' in value) || typeof value.source_name !== 'string') return false
  if (!('source_url' in value) || typeof value.source_url !== 'string' || !value.source_url.startsWith('https://')) return false
  if (!('data_class' in value) || value.data_class !== 'external_observation') return false
  if (!('fetched_at' in value) || (value.fetched_at !== null && (typeof value.fetched_at !== 'string' || !Number.isFinite(Date.parse(value.fetched_at))))) return false
  if (!('stale' in value) || typeof value.stale !== 'boolean') return false
  if (!('error' in value) || (value.error !== null && typeof value.error !== 'string')) return false
  if (!('disclaimer' in value) || typeof value.disclaimer !== 'string') return false
  if ('cache_age_seconds' in value && (typeof value.cache_age_seconds !== 'number' || !Number.isFinite(value.cache_age_seconds) || value.cache_age_seconds < 0)) return false
  return value.items.every((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false
    if (!('id' in item) || typeof item.id !== 'string' || !item.id) return false
    if (!('magnitude' in item) || (item.magnitude !== null && (typeof item.magnitude !== 'number' || !Number.isFinite(item.magnitude)))) return false
    if (!('place' in item) || typeof item.place !== 'string') return false
    if (!('time' in item) || typeof item.time !== 'string' || !Number.isFinite(Date.parse(item.time))) return false
    if (!('latitude' in item) || typeof item.latitude !== 'number' || !Number.isFinite(item.latitude) || item.latitude < -90 || item.latitude > 90) return false
    if (!('longitude' in item) || typeof item.longitude !== 'number' || !Number.isFinite(item.longitude) || item.longitude < -180 || item.longitude > 180) return false
    if (!('depth_km' in item) || (item.depth_km !== null && (typeof item.depth_km !== 'number' || !Number.isFinite(item.depth_km)))) return false
    return 'url' in item && typeof item.url === 'string' && item.url.startsWith('https://')
  })
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController()
  const abortRequest = () => controller.abort()
  if (init.signal?.aborted) controller.abort()
  else init.signal?.addEventListener('abort', abortRequest, { once: true })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = typeof body === 'object' && body !== null && 'detail' in body
        ? body.detail
        : null
      const message = typeof detail === 'string'
        ? detail
        : typeof detail === 'object' && detail !== null && 'message' in detail && typeof detail.message === 'string'
          ? detail.message
          : `ArkGrid API request failed (HTTP ${response.status}).`
      throw new ApiError(message, response.status)
    }
    return body as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
      throw new ApiError(timedOut
        ? 'ArkGrid API request timed out. Your local report remains saved.'
        : 'ArkGrid API request was cancelled.')
    }
    throw new ApiError(error instanceof Error ? error.message : 'ArkGrid API is unavailable.')
  } finally {
    clearTimeout(timeout)
    init.signal?.removeEventListener('abort', abortRequest)
  }
}

export const arkgridApi = {
  async health(signal?: AbortSignal): Promise<HealthResponse> {
    const value = await request<unknown>('/api/health', signal ? { signal } : {}, 4000)
    if (!isHealthResponse(value)) {
      throw new ApiError('ArkGrid backend health check returned an invalid response.')
    }
    return value
  },

  async earthquakes(minMagnitude = -2, refresh = false): Promise<EarthquakeResponse> {
    const query = new URLSearchParams({ min_magnitude: String(minMagnitude) })
    if (refresh) query.set('refresh', 'true')
    const response = await request<unknown>(`/api/hazards/earthquakes?${query}`, {}, 18000)
    if (!isEarthquakeResponse(response)) {
      throw new ApiError('ArkGrid earthquake endpoint returned an invalid response.')
    }
    return response
  },

  incidents(filters: { search?: string; type?: string; severity?: string; status?: string; location?: string } = {}) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
    return request<{ items: Incident[]; total: number }>(`/api/incidents${query.size ? `?${query}` : ''}`)
  },

  incident(id: string) {
    return request<Incident>(`/api/incidents/${encodeURIComponent(id)}`)
  },

  createIncident(payload: Record<string, unknown>, idempotencyKey: string) {
    return request<Incident>('/api/incidents', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    })
  },

  updateIncident(id: string, update: { status?: Incident['status']; internal_note?: string }) {
    return request<Incident>(`/api/incidents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    })
  },

  resources() {
    return request<ResourceResponse>('/api/resources')
  },

  createResource(payload: { name: string; capabilities: string[]; location: string }) {
    return request<Resource>('/api/resources', { method: 'POST', body: JSON.stringify(payload) })
  },

  assignResource(incidentId: string, resourceId: string) {
    return request<Incident>(`/api/incidents/${encodeURIComponent(incidentId)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ resource_id: resourceId }),
    })
  },

  overridePriority(incidentId: string, score: number, reason: string, token: string) {
    return request<PriorityAssessment>(`/api/incidents/${encodeURIComponent(incidentId)}/priority-override`, {
      method: 'POST',
      headers: { 'X-Coordinator-Token': token },
      body: JSON.stringify({ score, reason }),
    })
  },

  sourceStatuses() {
    return request<{ items: SourceStatus[]; checked_at: string }>('/api/sources/status', {}, 12000)
  },

  scenarios() {
    return request<{ items: { id: string; name: string; data_class: string }[] }>('/api/scenarios')
  },

  suggestCategory(text: string) {
    return request<{ category: EmergencyCategory | null; score: number; model: string }>('/api/ml/category-suggestion', {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
  },

  floodDemoSimulation(input: FloodSimulationInput) {
    return request<FloodSimulationResponse>('/api/flood/demo-simulation', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async syncEmergencyReport(report: EmergencyReport) {
    await this.health()
    const response = await this.createIncident({
      incidentType: report.incidentType,
      severity: report.severity,
      category: report.category,
      message: report.message,
      peopleAffected: report.peopleAffected,
      assistanceNote: report.assistanceNote,
      latitude: report.latitude,
      longitude: report.longitude,
      manualLocation: report.manualLocation,
      locationConfidence: report.locationSource === 'device'
        ? report.locationAccuracyMeters !== null && report.locationAccuracyMeters <= 100
          ? 'high'
          : report.locationAccuracyMeters !== null && report.locationAccuracyMeters <= 1000
            ? 'medium'
            : 'low'
        : 'low',
      locationSource: report.locationSource,
      locationAccuracyMeters: report.locationAccuracyMeters,
      locationCapturedAt: report.locationCapturedAt,
      medicalUrgency: report.category === 'Medical assistance',
      dataClass: 'citizen_report',
      consentConfirmed: true,
      source: 'offline_emergency_mode',
    }, report.id)
    return { serverId: response.id, synchronizedAt: response.updated_at }
  },
}
