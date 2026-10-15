import {
  demoLowerRiskCandidates,
  demoSettlements,
} from './demoData'

export type Coordinate = [number, number]
export type ScenarioSettlement = {
  id: string
  name: string
  latitude: number
  longitude: number
  population: number
}
export type LowerRiskCandidate = {
  id: string
  name: string
  latitude: number
  longitude: number
  riskScore: number
  capacity: number
  distanceKm: number
  insideCorridor: boolean
  recommended: boolean
  reason: string
}

const demoOrigin: Coordinate = [26.75, 87.2]

export function shiftDemoCoordinate(
  coordinate: Coordinate,
  origin: Coordinate,
): Coordinate {
  return [
    Number((coordinate[0] + origin[0] - demoOrigin[0]).toFixed(5)),
    Number((coordinate[1] + origin[1] - demoOrigin[1]).toFixed(5)),
  ]
}

function localMeters(point: Coordinate, latitudeOrigin: number): Coordinate {
  const latitudeScale = 110_574
  const longitudeScale = 111_320 * Math.cos(latitudeOrigin * Math.PI / 180)
  return [point[1] * longitudeScale, point[0] * latitudeScale]
}

function distanceToSegmentKm(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const latitudeOrigin = (point[0] + start[0] + end[0]) / 3
  const p = localMeters(point, latitudeOrigin)
  const a = localMeters(start, latitudeOrigin)
  const b = localMeters(end, latitudeOrigin)
  const abX = b[0] - a[0]
  const abY = b[1] - a[1]
  const lengthSquared = abX * abX + abY * abY
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((p[0] - a[0]) * abX + (p[1] - a[1]) * abY) / lengthSquared))
  return Math.hypot(p[0] - (a[0] + projection * abX), p[1] - (a[1] + projection * abY)) / 1000
}

export function distanceToPathKm(point: Coordinate, path: Coordinate[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY
  if (path.length === 1) return distanceToSegmentKm(point, path[0], path[0])
  return Math.min(...path.slice(1).map((end, index) =>
    distanceToSegmentKm(point, path[index], end),
  ))
}

export function scenarioSettlements(origin: Coordinate): ScenarioSettlement[] {
  return demoSettlements.map(settlement => {
    const [latitude, longitude] = shiftDemoCoordinate(
      [settlement.latitude, settlement.longitude],
      origin,
    )
    return { ...settlement, latitude, longitude }
  })
}

export function affectedSettlements(
  path: Coordinate[],
  origin: Coordinate,
  minimumRisk: number,
  corridorWidthKm: number,
): ScenarioSettlement[] {
  if (minimumRisk < 0.45) return []
  return scenarioSettlements(origin).filter(settlement =>
    distanceToPathKm([settlement.latitude, settlement.longitude], path) <= corridorWidthKm,
  )
}

export function lowerRiskCandidates(
  path: Coordinate[],
  origin: Coordinate,
  affected: ScenarioSettlement[],
  maximumRiskScore: number,
  corridorWidthKm: number,
): LowerRiskCandidate[] {
  const referencePoints = affected.length > 0
    ? affected.map(item => [item.latitude, item.longitude] as Coordinate)
    : path
  return demoLowerRiskCandidates.map(candidate => {
    const [latitude, longitude] = shiftDemoCoordinate(
      [candidate.latitude, candidate.longitude],
      origin,
    )
    const location: Coordinate = [latitude, longitude]
    const insideCorridor = distanceToPathKm(location, path) <= corridorWidthKm
    const distanceKm = referencePoints.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.min(...referencePoints.map(point => distanceToPathKm(location, [point])))
    const riskAcceptable = candidate.riskScore <= maximumRiskScore
    const recommended = !insideCorridor && riskAcceptable
    const reason = insideCorridor
      ? 'Excluded: inside the illustrative hazard corridor.'
      : !riskAcceptable
        ? `Excluded: illustrative risk score ${candidate.riskScore.toFixed(2)} exceeds the selected threshold ${maximumRiskScore.toFixed(2)}.`
        : `Outside the illustrative corridor, below the selected risk threshold, and ranked ${distanceKm.toFixed(1)} km from the affected area.`
    return {
      ...candidate,
      latitude,
      longitude,
      distanceKm,
      insideCorridor,
      recommended,
      reason,
    }
  }).sort((left, right) =>
    Number(right.recommended) - Number(left.recommended) ||
    left.distanceKm - right.distanceKm ||
    left.riskScore - right.riskScore,
  )
}

export type LandslideInputs = {
  rainfallMm: number
  slope: 'gentle' | 'moderate' | 'steep'
  soil: 'dry' | 'moist' | 'saturated'
}

const slopeFactors: Record<LandslideInputs['slope'], number> = {
  gentle: 0.15,
  moderate: 0.48,
  steep: 0.82,
}
const soilFactors: Record<LandslideInputs['soil'], number> = {
  dry: 0.12,
  moist: 0.48,
  saturated: 0.86,
}

export function landslideRiskScore(inputs: LandslideInputs): number {
  const rainfallFactor = Math.max(0, Math.min(1, inputs.rainfallMm / 400))
  return Math.round((rainfallFactor * 0.35 + slopeFactors[inputs.slope] * 0.35 + soilFactors[inputs.soil] * 0.3) * 100) / 100
}

export function landslidePath(
  start: Coordinate,
  inputs: LandslideInputs,
): Coordinate[] {
  const distance = 0.055 + slopeFactors[inputs.slope] * 0.07 + Math.min(inputs.rainfallMm, 400) / 400 * 0.025
  return [
    start,
    [start[0] - distance / 2, start[1] + distance * 0.22],
    [start[0] - distance, start[1] + distance * 0.55],
  ]
}

export function syntheticLandslideCells(
  path: Coordinate[],
  riskScore: number,
): { id: string; latitude: number; longitude: number; riskScore: number; riskClass: 'low' | 'moderate' | 'high' }[] {
  return path.slice(1).map(([latitude, longitude], index) => {
    const cellRisk = Math.max(0, Math.round((riskScore - index * 0.12) * 100) / 100)
    return {
      id: `landslide-cell-${index + 1}`,
      latitude,
      longitude,
      riskScore: cellRisk,
      riskClass: cellRisk >= 0.7 ? 'high' : cellRisk >= 0.45 ? 'moderate' : 'low',
    }
  })
}
