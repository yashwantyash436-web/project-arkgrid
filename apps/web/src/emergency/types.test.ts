import { describe, expect, it } from 'vitest'
import { emptyEmergencyDraft, isValidCoordinate, validateEmergencyDraft } from './types'

describe('emergency report validation', () => {
  it('requires a positive integer people count and a usable location', () => {
    expect(validateEmergencyDraft({
      ...emptyEmergencyDraft,
      peopleAffected: 0,
      manualLocation: '',
    })).toEqual([
      'Enter a whole number of people between 1 and 99,999.',
      'Add a location description or allow location access.',
    ])

    expect(validateEmergencyDraft({
      ...emptyEmergencyDraft,
      peopleAffected: 2.5,
      manualLocation: 'Near the bridge',
    })).toContain('Enter a whole number of people between 1 and 99,999.')
  })

  it('accepts either valid coordinates or a manual location description', () => {
    expect(validateEmergencyDraft({
      ...emptyEmergencyDraft,
      latitude: 27.7172,
      longitude: 85.324,
    })).toEqual([])
    expect(validateEmergencyDraft({
      ...emptyEmergencyDraft,
      latitude: 27.7172,
      manualLocation: 'Near the clinic',
    })).toContain('Provide both selected coordinates.')
    expect(isValidCoordinate(91, 0)).toBe(false)
    expect(isValidCoordinate(0, -181)).toBe(false)
  })
})
