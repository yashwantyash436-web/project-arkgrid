export type Incident = { id: string; title: string; location: string; severity: 'Critical' | 'High' | 'Moderate'; status: string; updated: string; description: string; lat: number; lng: number }

export const incidents: Incident[] = [
  { id: 'SIM-024', title: 'Temporary shelter support request', location: 'Koshi Province, Nepal', severity: 'High', status: 'Triaged', updated: 'Demo fixture', description: 'Simulated request used to demonstrate a coordinator review workflow.', lat: 26.72, lng: 87.29 },
  { id: 'SIM-019', title: 'Road access assessment', location: 'Sunsari District, Nepal', severity: 'Moderate', status: 'New', updated: 'Demo fixture', description: 'Simulated field report; it is not an operational dispatch request.', lat: 26.65, lng: 87.17 },
  { id: 'SIM-011', title: 'Medical supply relay', location: 'Morang District, Nepal', severity: 'Critical', status: 'Assigned', updated: 'Demo fixture', description: 'Simulated scenario resource request for interface testing.', lat: 26.66, lng: 87.46 },
]
export const resources = [['RES-07', 'High-clearance vehicle', 'Available', 'Sunsari depot'], ['RES-12', 'Medical support team', 'En route', 'Morang staging area'], ['RES-18', 'Portable water unit', 'Available', 'Koshi Province']]
export const areas = { nepal: { label: 'Nepal historical flood demonstration', center: [26.75, 87.25] as [number, number], zoom: 8 }, custom: { label: 'Custom area of interest', center: [20.59, 78.96] as [number, number], zoom: 5 } }
