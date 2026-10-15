export type SeismicRegion = {
  id: string
  name: string
  description: string
  center: [number, number]
  zoom: number
  bounds: {
    south: number
    north: number
    longitudeRanges: [number, number][]
  }
  outlineBounds: [number, number, number, number][]
  sourceName: string
  sourceUrl: string
}

export const seismicRegions: SeismicRegion[] = [
  {
    id: 'japan',
    name: 'Japan',
    description: 'Japan Trench and surrounding seismic region; approximate monitoring bounds, not a hazard boundary.',
    center: [38, 141],
    zoom: 5,
    bounds: { south: 30, north: 46, longitudeRanges: [[130, 147]] },
    outlineBounds: [[30, 130, 46, 147]],
    sourceName: 'Japan Meteorological Agency · earthquakes',
    sourceUrl: 'https://www.jma.go.jp/jma/en/Activities/earthquake.html',
  },
  {
    id: 'nepal',
    name: 'Nepal',
    description: 'Himalayan seismic region; approximate monitoring bounds, not a hazard boundary.',
    center: [28.3, 84.5],
    zoom: 6,
    bounds: { south: 26, north: 31, longitudeRanges: [[78, 89.5]] },
    outlineBounds: [[26, 78, 31, 89.5]],
    sourceName: 'USGS · 2015 Gorkha earthquake',
    sourceUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/us20002926/executive',
  },
  {
    id: 'indonesia',
    name: 'Indonesia',
    description: 'Sunda Arc and nearby Indonesian seismic region; approximate monitoring bounds, not a hazard boundary.',
    center: [-2, 118],
    zoom: 4,
    bounds: { south: -12, north: 8, longitudeRanges: [[94, 141]] },
    outlineBounds: [[-12, 94, 8, 141]],
    sourceName: 'USGS · 2004 Sumatra-Andaman earthquake',
    sourceUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/official20041226005853450_30/executive',
  },
  {
    id: 'turkiye',
    name: 'Türkiye',
    description: 'North Anatolian Fault and surrounding Anatolian seismic region; approximate monitoring bounds, not a hazard boundary.',
    center: [39, 35],
    zoom: 5,
    bounds: { south: 35, north: 42, longitudeRanges: [[25, 46]] },
    outlineBounds: [[35, 25, 42, 46]],
    sourceName: 'USGS · 2023 Türkiye earthquake sequence',
    sourceUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000jllz/executive',
  },
  {
    id: 'chile',
    name: 'Chile',
    description: 'Andean subduction zone along Chile; approximate monitoring bounds, not a hazard boundary.',
    center: [-36, -71],
    zoom: 4,
    bounds: { south: -56, north: -17, longitudeRanges: [[-76, -65]] },
    outlineBounds: [[-56, -76, -17, -65]],
    sourceName: 'USGS · 2010 Maule earthquake',
    sourceUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/official20100227063411530_30/executive',
  },
  {
    id: 'western-us',
    name: 'Western United States',
    description: 'California and the western United States; approximate monitoring bounds, not a hazard boundary.',
    center: [40, -119],
    zoom: 4,
    bounds: { south: 31, north: 50, longitudeRanges: [[-127, -110]] },
    outlineBounds: [[31, -127, 50, -110]],
    sourceName: 'USGS · California earthquake hazards',
    sourceUrl: 'https://www.usgs.gov/programs/earthquake-hazards/science/earthquake-hazards-california',
  },
  {
    id: 'new-zealand',
    name: 'New Zealand',
    description: 'Alpine Fault and surrounding plate-boundary region; approximate monitoring bounds, not a hazard boundary.',
    center: [-41, 174],
    zoom: 5,
    bounds: { south: -48, north: -33, longitudeRanges: [[165, 180], [-180, -170]] },
    outlineBounds: [[-48, 165, -33, 180], [-48, -180, -33, -170]],
    sourceName: 'GeoNet · earthquake monitoring',
    sourceUrl: 'https://www.geonet.org.nz/earthquake',
  },
]

export function isInSeismicRegion(latitude: number, longitude: number, region: SeismicRegion): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false
  return latitude >= region.bounds.south && latitude <= region.bounds.north &&
    region.bounds.longitudeRanges.some(([west, east]) => longitude >= west && longitude <= east)
}
