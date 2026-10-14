export const incidentTypes = [
  'Medical emergency',
  'Trapped or missing',
  'Evacuation needed',
  'Shelter needed',
  'Other urgent need',
] as const

export const emergencyCategories = [
  'Medical assistance',
  'Rescue',
  'Evacuation',
  'Shelter',
  'Food or water',
  'Other',
] as const

export type IncidentType = (typeof incidentTypes)[number]
export type EmergencyCategory = (typeof emergencyCategories)[number]
export type Severity = 'Critical' | 'High' | 'Moderate'

export type EmergencyDraft = {
  incidentType: IncidentType
  severity: Severity
  category: EmergencyCategory
  message: string
  peopleAffected: number
  assistanceNote: string
  latitude: number | null
  longitude: number | null
  manualLocation: string
}

export type TransmissionStatus =
  | 'not_started'
  | 'composer_opened'
  | 'user_marked_attempted'
  | 'copied_for_manual_send'

export type SyncStatus = 'not_configured' | 'pending' | 'synchronized' | 'failed'

export type EmergencyReport = EmergencyDraft & {
  id: string
  createdAt: string
  transmissionStatus: TransmissionStatus
  transmissionAttemptedAt: string | null
  syncStatus: SyncStatus
  syncAttemptedAt: string | null
  syncError: string | null
}

export type EmergencySettings = {
  id: 'settings'
  trustedContacts: string[]
  lastSyncAt: string | null
}

export const emptyEmergencyDraft: EmergencyDraft = {
  incidentType: 'Medical emergency',
  severity: 'Critical',
  category: 'Medical assistance',
  message: '',
  peopleAffected: 1,
  assistanceNote: '',
  latitude: null,
  longitude: null,
  manualLocation: '',
}

export function validateEmergencyDraft(draft: EmergencyDraft): string[] {
  const errors: string[] = []
  if (!incidentTypes.includes(draft.incidentType)) errors.push('Choose an incident type.')
  if (!['Critical', 'High', 'Moderate'].includes(draft.severity)) errors.push('Choose a severity.')
  if (!emergencyCategories.includes(draft.category)) errors.push('Choose an emergency category.')
  if (!Number.isInteger(draft.peopleAffected) || draft.peopleAffected < 1 || draft.peopleAffected > 99999) {
    errors.push('Enter a whole number of people between 1 and 99,999.')
  }
  if (draft.message.trim().length > 500) errors.push('Keep the message to 500 characters or fewer.')
  if (draft.assistanceNote.trim().length > 300) errors.push('Keep the assistance note to 300 characters or fewer.')
  const hasLatitude = draft.latitude !== null
  const hasLongitude = draft.longitude !== null
  if (hasLatitude !== hasLongitude) errors.push('Provide both selected coordinates.')
  if (
    draft.latitude !== null &&
    draft.longitude !== null &&
    !isValidCoordinate(draft.latitude, draft.longitude)
  ) {
    errors.push('The selected coordinates are invalid.')
  }
  if (!hasLatitude && !hasLongitude && !draft.manualLocation.trim()) {
    errors.push('Add a location description or allow location access.')
  }
  if (draft.manualLocation.trim().length > 160) errors.push('Keep the location description to 160 characters or fewer.')
  return errors
}

export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
}

export function createReportId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    const values = crypto.getRandomValues(new Uint8Array(16))
    values[6] = (values[6] & 0x0f) | 0x40
    values[8] = (values[8] & 0x3f) | 0x80
    const hex = Array.from(values, value => value.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
