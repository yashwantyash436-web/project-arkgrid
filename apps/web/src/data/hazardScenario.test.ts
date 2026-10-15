import { describe, expect, it } from 'vitest'
import {
  affectedSettlements,
  landslidePath,
  landslideRiskScore,
  lowerRiskCandidates,
  shiftDemoCoordinate,
  syntheticLandslideCells,
} from './hazardScenario'
import type { Coordinate, LandslideInputs } from './hazardScenario'

const origin: Coordinate = [26.75, 87.2]
const path: Coordinate[] = [
  origin,
  [26.715, 87.245],
  [26.68, 87.29],
  [26.645, 87.335],
]

describe('deterministic demonstration hazard rules', () => {
  it('translates the documented synthetic settlement layer with the selected source point', () => {
    expect(shiftDemoCoordinate([26.715, 87.245], [27.1, 86.9])).toEqual([27.065, 86.945])
  })

  it('counts only fictional settlements intersecting an elevated synthetic corridor', () => {
    const affected = affectedSettlements(path, origin, 0.72, 4)

    expect(affected.map(settlement => settlement.id)).toEqual([
      'settlement-1',
      'settlement-2',
      'settlement-3',
    ])
    expect(affected.reduce((total, settlement) => total + settlement.population, 0)).toBe(1410)
    expect(affectedSettlements(path, origin, 0.3, 4)).toEqual([])
  })

  it('excludes in-corridor and above-threshold locations and explains each candidate', () => {
    const insidePath: Coordinate[] = [[26.94, 87.31], [26.93, 87.32]]
    const candidates = lowerRiskCandidates(insidePath, origin, [], 0.8, 2)

    expect(candidates.find(candidate => candidate.id === 'demo-shelter-1')).toMatchObject({
      insideCorridor: true,
      recommended: false,
      reason: expect.stringContaining('inside'),
    })
    expect(lowerRiskCandidates(path, origin, [], 0.1, 8).every(candidate => !candidate.recommended)).toBe(true)
    expect(candidates.find(candidate => candidate.recommended)?.reason).toContain('ranked')
  })

  it('calculates a reproducible landslide heuristic and corridor from the explicit demo inputs', () => {
    const inputs: LandslideInputs = { rainfallMm: 180, slope: 'steep', soil: 'moist' }
    const score = landslideRiskScore(inputs)
    const corridor = landslidePath(origin, inputs)

    expect(score).toBe(0.59)
    expect(corridor).toEqual(landslidePath(origin, inputs))
    expect(corridor[0]).toEqual(origin)
    expect(corridor[2][0]).toBeLessThan(corridor[0][0])
    expect(corridor[2][1]).toBeGreaterThan(corridor[0][1])
    expect(syntheticLandslideCells(corridor, score)).toHaveLength(2)
    expect(landslideRiskScore({ ...inputs, slope: 'gentle', soil: 'dry' })).toBeLessThan(score)
  })
})
