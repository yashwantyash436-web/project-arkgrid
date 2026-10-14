export type PriorityFactor = {
  key: string
  points: number
  explanation: string
}

export type PriorityAssessment = {
  score: number
  band: 'immediate' | 'high' | 'elevated' | 'routine'
  factors: PriorityFactor[]
  uncertainty: string[]
  explanation: string
  method: string
  override_reason: string | null
}

export type Incident = {
  id: string
  idempotency_key: string
  incident_type: string
  severity: 'Critical' | 'High' | 'Moderate'
  category: string
  message: string
  people_affected: number | null
  assistance_note: string
  consent_confirmed: boolean
  latitude: number | null
  longitude: number | null
  manual_location: string
  location_source: 'device' | 'manual' | 'unknown'
  location_accuracy_meters: number | null
  location_captured_at: string | null
  location_confidence: 'unknown' | 'low' | 'medium' | 'high'
  immediate_life_threat: boolean | null
  medical_urgency: boolean | null
  data_class: 'simulation' | 'external_observation' | 'historical_reference' | 'citizen_report'
  source: string
  status: 'new' | 'triaged' | 'assigned' | 'resolved' | 'closed'
  created_at: string
  updated_at: string
  internal_notes: { text: string; created_at: string }[]
  assigned_resource_id: string | null
  priority: PriorityAssessment
}

export type Earthquake = {
  id: string
  magnitude: number | null
  place: string
  time: string
  latitude: number
  longitude: number
  depth_km: number | null
  url: string
}

export type EarthquakeResponse = {
  items: Earthquake[]
  total: number
  source_name: string
  source_url: string
  data_class: 'external_observation'
  fetched_at: string | null
  stale: boolean
  error: string | null
  disclaimer: string
}

export type Resource = {
  id: string
  name: string
  capabilities: string[]
  location: string
  latitude: number | null
  longitude: number | null
  is_simulated: true
  available: boolean
  assigned_incident_id: string | null
}

export type ResourceResponse = {
  items: Resource[]
  total: number
  connected_real_resources: number
  notice: string
}

export type SourceStatus = {
  name: string
  url: string
  page_reachable: boolean
  http_status: number | null
  data_available: boolean
  last_successful_retrieval: string | null
  integration_status: string
  data_class: string
  requires_credentials: boolean
  data_returned?: unknown
  metadata_available?: boolean
  limitations: string
  error?: string
}
