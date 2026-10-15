import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Polygon, Polyline, Popup, Rectangle, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import {
  demoFloodPropagationPath,
  demoFloodRiskCells,
  demoLowerRiskCandidates,
  demoLandslideZones,
  demoResources,
  demoSettlements,
  incidents as demoIncidents,
  type Incident as DemoIncident,
} from '../data/demoData'
import type { Earthquake, Incident } from '../api/types'
import { emptyHazardLayers } from './mapTypes'
import type { HazardLayers, MapFeature } from './mapTypes'
import type { SeismicRegion } from '../data/seismicRegions'

function AreaSelector({ onPoint }: { onPoint: (lat: number, lng: number) => void }) { useMapEvents({ click: (event) => onPoint(event.latlng.lat, event.latlng.lng) }); return null }

function SelectedEarthquakeFocus({ event }: { event: Earthquake | null }) {
  const map = useMap()
  useEffect(() => {
    if (event) map.flyTo([event.latitude, event.longitude], Math.max(map.getZoom(), 5), { duration: 0.35 })
  }, [event, map])
  return null
}

export function MapView({
  center,
  zoom,
  onAreaSelect,
  markers = true,
  earthquakes = [],
  showEarthquakes = true,
  selectedEarthquakeId,
  onEarthquakeSelect,
  selectedSeismicRegion = null,
  showRegionBounds = false,
  selectedDemoIncidentId,
  onDemoIncidentSelect,
  incidentReports = [],
  layers = emptyHazardLayers,
  selectedFeatureId,
  onIncidentSelect,
  onFeatureSelect,
}: {
  center: [number, number]
  zoom: number
  onAreaSelect: (lat: number, lng: number) => void
  markers?: boolean
  earthquakes?: Earthquake[]
  showEarthquakes?: boolean
  selectedEarthquakeId?: string
  onEarthquakeSelect?: (earthquake: Earthquake) => void
  selectedSeismicRegion?: SeismicRegion | null
  showRegionBounds?: boolean
  selectedDemoIncidentId?: string
  onDemoIncidentSelect?: (incident: DemoIncident) => void
  incidentReports?: Incident[]
  layers?: HazardLayers
  selectedFeatureId?: string
  onIncidentSelect?: (incident: Incident) => void
  onFeatureSelect?: (feature: MapFeature) => void
}) {
  const [tilesUnavailable, setTilesUnavailable] = useState(false)
  return (
    <div className="relative h-full">
      <MapContainer key={`${center[0]}-${center[1]}`} center={center} zoom={zoom} scrollWheelZoom className="rounded-xl">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{
            tileerror: () => setTilesUnavailable(true),
            tileload: () => setTilesUnavailable(false),
          }}
        />
        <AreaSelector onPoint={onAreaSelect} />
        <SelectedEarthquakeFocus event={earthquakes.find(event => event.id === selectedEarthquakeId) ?? null} />
        {showRegionBounds && selectedSeismicRegion?.outlineBounds.map(([south, west, north, east], index) => (
          <Rectangle key={`${selectedSeismicRegion.id}-bounds-${index}`} bounds={[[south, west], [north, east]]}
            pathOptions={{ color: '#087e8b', weight: 2, dashArray: '6 5', fillColor: '#22b8c7', fillOpacity: 0.04 }}>
            <Popup>{selectedSeismicRegion.name} · approximate monitoring bounds only, not an official hazard boundary or earthquake prediction.</Popup>
          </Rectangle>
        ))}
        {layers.floodPath && (
          <Polyline positions={demoFloodPropagationPath}
            pathOptions={{ color: '#d13b2f', weight: 24, opacity: 0.22, lineCap: 'round' }}>
            <Popup>SIMULATED FLOOD SCENARIO — deterministic south-east grid illustration, not a forecast.</Popup>
          </Polyline>
        )}
        {layers.floodPath && (
          <Polyline positions={demoFloodPropagationPath}
            pathOptions={{ color: '#b8322a', weight: 4, dashArray: '8 7', lineCap: 'round' }}>
            <Popup>Illustrative flood propagation direction. This is not a hydrological flow calculation.</Popup>
          </Polyline>
        )}
        {layers.floodRisk && demoFloodRiskCells.map(cell => {
          const color = cell.riskClass === 'high' ? '#c7352b' : cell.riskClass === 'moderate' ? '#dd8427' : '#27846f'
          return <CircleMarker key={cell.id} center={[cell.latitude, cell.longitude]} radius={23}
            pathOptions={{ color, fillColor: color, fillOpacity: 0.2, weight: 1 }}
            eventHandlers={{ click: () => onFeatureSelect?.({
              id: cell.id,
              label: `${cell.riskClass} synthetic flood-risk cell`,
              description: 'A fixed illustrative scenario cell. Its risk class comes from the synthetic demonstration fixture, not live hydrology.',
              latitude: cell.latitude,
              longitude: cell.longitude,
            }) }}>
            <Popup>SIMULATED flood-risk cell · {cell.riskClass} illustrative level</Popup>
          </CircleMarker>
        })}
        {layers.landslideZones && demoLandslideZones.map((zone, index) => (
          <Polygon key={`landslide-zone-${index}`} positions={zone}
            pathOptions={{ color: '#a85924', fillColor: '#e5913e', fillOpacity: 0.28, weight: 2 }}
            eventHandlers={{ click: () => onFeatureSelect?.({
              id: `landslide-zone-${index}`,
              label: 'Simulated landslide assessment zone',
              description: 'A deterministic demonstration polygon only; it is not based on real terrain or a validated slope model.',
              latitude: zone[0][0],
              longitude: zone[0][1],
            }) }}>
            <Popup>SIMULATED LANDSLIDE SCENARIO — DEMONSTRATION ONLY</Popup>
          </Polygon>
        ))}
        {layers.affectedPopulation && demoSettlements.map(settlement => (
          <CircleMarker key={settlement.id} center={[settlement.latitude, settlement.longitude]} radius={7}
            pathOptions={{ color: '#146a94', fillColor: '#35a5cf', fillOpacity: 0.9, weight: 2 }}
            eventHandlers={{ click: () => onFeatureSelect?.({
              id: settlement.id,
              label: `${settlement.name} · simulated`,
              description: `Illustrative population estimate: ${settlement.population.toLocaleString()}. This is fictional demonstration data.`,
              latitude: settlement.latitude,
              longitude: settlement.longitude,
            }) }}>
            <Popup>{settlement.name} · simulated population {settlement.population.toLocaleString()}</Popup>
          </CircleMarker>
        ))}
        {layers.lowerRiskLocations && demoLowerRiskCandidates.map(candidate => (
          <CircleMarker key={candidate.id} center={[candidate.latitude, candidate.longitude]} radius={8}
            pathOptions={{ color: '#216c54', fillColor: '#38a77e', fillOpacity: 0.9, weight: 2 }}
            eventHandlers={{ click: () => onFeatureSelect?.({
              id: candidate.id,
              label: `Potentially lower-risk demonstration location · ${candidate.name}`,
              description: `Illustrative risk score ${candidate.riskScore.toFixed(2)}; example capacity ${candidate.capacity}. Not a verified shelter or guaranteed safe location.`,
              latitude: candidate.latitude,
              longitude: candidate.longitude,
            }) }}>
            <Popup>{candidate.name} · potentially lower-risk demonstration location, not guaranteed safe</Popup>
          </CircleMarker>
        ))}
        {layers.fictionalResources && demoResources.map(resource => (
          <CircleMarker key={resource.id} center={[resource.latitude, resource.longitude]} radius={8}
            pathOptions={{ color: '#245a9b', fillColor: '#4a8cd1', fillOpacity: 0.9, weight: 2 }}
            eventHandlers={{ click: () => onFeatureSelect?.({
              id: resource.id,
              label: resource.name,
              description: `Fictional demonstration resource · ${resource.status}. This does not dispatch a real responder or vehicle.`,
              latitude: resource.latitude,
              longitude: resource.longitude,
            }) }}>
            <Popup>{resource.name} · {resource.status}</Popup>
          </CircleMarker>
        ))}
        {layers.citizenReports && incidentReports.filter(
          (incident): incident is Incident & { latitude: number; longitude: number } =>
            incident.latitude !== null && incident.longitude !== null,
        ).map(incident => (
          <CircleMarker key={incident.id} center={[incident.latitude, incident.longitude]} radius={selectedFeatureId === incident.id ? 11 : 8}
            pathOptions={{ color: incident.severity === 'Critical' ? '#a52721' : incident.severity === 'High' ? '#ce7121' : '#287a94', fillColor: '#ed8a36', fillOpacity: 0.78, weight: 2 }}
            eventHandlers={{ click: () => onIncidentSelect?.(incident) }}>
            <Popup>
              <strong>Citizen report · {incident.severity}</strong><br />
              {incident.incident_type}<br />
              {incident.manual_location || `${incident.latitude}, ${incident.longitude}`}<br />
              Report only · unverified
            </Popup>
          </CircleMarker>
        ))}
        {markers && demoIncidents.map((incident: DemoIncident) => (
          <CircleMarker key={incident.id} center={[incident.lat, incident.lng]} radius={selectedDemoIncidentId === incident.id ? 11 : 8}
            pathOptions={{ color: incident.severity === 'Critical' ? '#b42318' : '#c27a18', fillOpacity: 0.85 }}
            eventHandlers={{ click: () => onDemoIncidentSelect?.(incident) }}>
            <Popup>
              <strong>{incident.title}</strong><br />{incident.id} — SIMULATED<br />{incident.location}<br />{incident.description}
            </Popup>
          </CircleMarker>
        ))}
        {showEarthquakes && earthquakes.map(event => (
          <CircleMarker
            key={event.id}
            center={[event.latitude, event.longitude]}
            radius={selectedEarthquakeId === event.id ? 11 : event.magnitude !== null && event.magnitude >= 4 ? 9 : 6}
            pathOptions={{ color: '#0e7490', fillColor: '#22b8c7', fillOpacity: 0.85, weight: selectedEarthquakeId === event.id ? 4 : 2 }}
            eventHandlers={{ click: () => onEarthquakeSelect?.(event) }}
          >
            <Popup>
              <strong>USGS observation · M{event.magnitude ?? 'unknown'}</strong><br />
              {event.place}<br />
              {new Date(event.time).toLocaleString()}<br />
              {event.depth_km !== null && <>Depth: {event.depth_km} km<br /></>}
              <a href={event.url} target="_blank" rel="noreferrer">Open USGS event</a>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {tilesUnavailable && (
        <p role="status" className="pointer-events-none absolute left-3 right-3 top-3 z-[1000] rounded-lg bg-white/95 p-3 text-sm font-semibold text-slate-900 shadow">
          Map tiles are unavailable. Emergency reporting still works; use the saved coordinates or enter a manual location.
          Basemap tiles are not cached offline.
        </p>
      )}
    </div>
  )
}
