import type { EmergencyReport } from '../emergency/types'
import type {
  EarthquakeResponse,
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

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
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
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('ArkGrid API request timed out. Your local report remains saved.')
    }
    throw new ApiError(error instanceof Error ? error.message : 'ArkGrid API is unavailable.')
  } finally {
    clearTimeout(timeout)
  }
}

export const arkgridApi = {
  async health(): Promise<HealthResponse> {
    const value = await request<unknown>('/api/health', {}, 4000)
    if (!isHealthResponse(value)) {
      throw new ApiError('ArkGrid backend health check returned an invalid response.')
    }
    return value
  },

  earthquakes(minMagnitude = -2): Promise<EarthquakeResponse> {
    const query = new URLSearchParams({ min_magnitude: String(minMagnitude) })
    return request<EarthquakeResponse>(`/api/hazards/earthquakes?${query}`)
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
