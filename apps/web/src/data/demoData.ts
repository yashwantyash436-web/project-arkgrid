export type Incident = { id: string; title: string; location: string; severity: 'Critical' | 'High' | 'Moderate'; status: string; updated: string; description: string; lat: number; lng: number }

export const incidents: Incident[] = [
  { id: 'SIM-024', title: 'Temporary shelter support request', location: 'Koshi Province, Nepal', severity: 'High', status: 'Triaged', updated: 'Demo fixture', description: 'Simulated request used to demonstrate a coordinator review workflow.', lat: 26.72, lng: 87.29 },
  { id: 'SIM-019', title: 'Road access assessment', location: 'Sunsari District, Nepal', severity: 'Moderate', status: 'New', updated: 'Demo fixture', description: 'Simulated field report; it is not an operational dispatch request.', lat: 26.65, lng: 87.17 },
  { id: 'SIM-011', title: 'Medical supply relay', location: 'Morang District, Nepal', severity: 'Critical', status: 'Assigned', updated: 'Demo fixture', description: 'Simulated scenario resource request for interface testing.', lat: 26.66, lng: 87.46 },
]
export const resources = [['RES-07', 'High-clearance vehicle', 'Available', 'Sunsari depot'], ['RES-12', 'Medical support team', 'En route', 'Morang staging area'], ['RES-18', 'Portable water unit', 'Available', 'Koshi Province']]
export const areas = { nepal: { label: 'Nepal historical flood demonstration', center: [26.75, 87.25] as [number, number], zoom: 8 }, custom: { label: 'Custom area of interest', center: [20.59, 78.96] as [number, number], zoom: 5 } }

export const demoSettlements = [
  { id: 'settlement-1', name: 'Koshi demo settlement A', latitude: 26.715, longitude: 87.245, population: 420 },
  { id: 'settlement-2', name: 'Koshi demo settlement B', latitude: 26.68, longitude: 87.29, population: 680 },
  { id: 'settlement-3', name: 'Koshi demo settlement C', latitude: 26.645, longitude: 87.335, population: 310 },
  { id: 'settlement-4', name: 'Koshi demo settlement D', latitude: 26.78, longitude: 87.38, population: 250 },
]

export const demoLowerRiskCandidates = [
  { id: 'demo-shelter-1', name: 'Hilltop community hall (demo)', latitude: 26.94, longitude: 87.31, riskScore: 0.12, capacity: 500 },
  { id: 'demo-shelter-2', name: 'East ridge school (demo)', latitude: 26.91, longitude: 87.48, riskScore: 0.22, capacity: 350 },
  { id: 'demo-shelter-3', name: 'North field shelter (demo)', latitude: 26.88, longitude: 87.15, riskScore: 0.31, capacity: 700 },
]

export const demoFloodPropagationPath: [number, number][] = [
  [26.75, 87.2],
  [26.715, 87.245],
  [26.68, 87.29],
  [26.645, 87.335],
]

export const demoFloodRiskCells = [
  { id: 'flood-cell-1', latitude: 26.75, longitude: 87.2, riskClass: 'moderate' as const },
  { id: 'flood-cell-2', latitude: 26.715, longitude: 87.245, riskClass: 'high' as const },
  { id: 'flood-cell-3', latitude: 26.68, longitude: 87.29, riskClass: 'high' as const },
  { id: 'flood-cell-4', latitude: 26.645, longitude: 87.335, riskClass: 'moderate' as const },
  { id: 'flood-cell-5', latitude: 26.785, longitude: 87.245, riskClass: 'low' as const },
]

export const demoLandslideZones = [
  [[26.79, 87.34], [26.765, 87.37], [26.745, 87.335], [26.79, 87.34]] as [number, number][],
  [[26.755, 87.375], [26.73, 87.405], [26.71, 87.37], [26.755, 87.375]] as [number, number][],
]

export const demoResources = [
  { id: 'RES-07', name: 'High-clearance vehicle · fictional', latitude: 26.72, longitude: 87.17, status: 'Available' },
  { id: 'RES-12', name: 'Medical support team · fictional', latitude: 26.66, longitude: 87.46, status: 'En route (demo)' },
  { id: 'RES-18', name: 'Portable water unit · fictional', latitude: 26.82, longitude: 87.4, status: 'Available' },
]
