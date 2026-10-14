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

export type FloodSimulationInput = {
  rainfallMm: number
  waterLevelM: number
  riverLevelM: number
  terrainElevationM: number
  waterLevelTrendMPerHour: number
  horizonHours: 0 | 1 | 3 | 6
}

export type FloodSimulationResponse = {
  scenario_id: string
  data_mode: 'DEMO SIMULATION'
  risk_class: 'low' | 'moderate' | 'high'
  horizon_hours: 0 | 1 | 3 | 6
  inputs: {
    rainfall_mm: number
    water_level_m: number
    river_level_m: number
    terrain_elevation_m: number
    water_level_trend_m_per_hour: number
  }
  cells: {
    id: string
    latitude: number
    longitude: number
    elevation_m: number
    risk_score: number
    risk_class: 'low' | 'moderate' | 'high'
  }[]
  timeline: { hour: 0 | 1 | 3 | 6; high_risk_cells: number; moderate_or_high_cells: number }[]
  routes: {
    id: string
    label: string
    geometry: [number, number][]
    distance_km: number
    mean_exposure_score: number
    high_risk_segments: number
    illustrative_route_score: number
  }[]
  selected_route_id: string | null
  route_warning: string | null
  model: {
    version: string
    algorithm: string
    score_kind: string
    synthetic_training_rows: number
    synthetic_held_out_rows: number
    held_out_synthetic_metrics: { precision: number; recall: number; f1: number }
  }
  source: string
  limitations: string[]
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
