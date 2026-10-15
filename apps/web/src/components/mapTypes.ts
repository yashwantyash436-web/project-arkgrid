export type HazardLayers = {
  citizenReports: boolean
  floodRisk: boolean
  floodPath: boolean
  landslideZones: boolean
  affectedPopulation: boolean
  lowerRiskLocations: boolean
  fictionalResources: boolean
}

export type MapFeature = {
  id: string
  label: string
  description: string
  latitude: number
  longitude: number
}

export const emptyHazardLayers: HazardLayers = {
  citizenReports: false,
  floodRisk: false,
  floodPath: false,
  landslideZones: false,
  affectedPopulation: false,
  lowerRiskLocations: false,
  fictionalResources: false,
}
