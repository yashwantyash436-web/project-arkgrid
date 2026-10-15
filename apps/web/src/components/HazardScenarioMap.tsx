import { useEffect } from 'react'
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { Earthquake, FloodSimulationResponse, Incident } from '../api/types'
import type { Coordinate, LowerRiskCandidate, ScenarioSettlement } from '../data/hazardScenario'
import type { MapFeature } from './mapTypes'

export type ScenarioMapLayers = {
  earthquakes: boolean
  citizenReports: boolean
  floodRisk: boolean
  floodPath: boolean
  landslideZones: boolean
  affectedPopulation: boolean
  lowerRiskLocations: boolean
  fictionalResources: boolean
}

function StartLocationPicker({
  enabled,
  onSelect,
}: {
  enabled: boolean
  onSelect: (point: Coordinate) => void
}) {
  useMapEvents({
    click(event) {
      if (enabled) onSelect([event.latlng.lat, event.latlng.lng])
    },
  })
  return null
}

function FollowCenter({ center }: { center: Coordinate }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, map.getZoom())
  }, [center, map])
  return null
}

function riskColor(risk: 'low' | 'moderate' | 'high'): string {
  return risk === 'high' ? '#c7352b' : risk === 'moderate' ? '#dd8427' : '#27846f'
}

export function HazardScenarioMap({
  center,
  sourceSelectable,
  onSourceSelect,
  floodScenario,
  landslidePath,
  landslideCells,
  landslideRisk,
  settlements,
  affectedSettlementIds,
  candidates,
  earthquakes,
  incidents,
  layers,
  onFeatureSelect,
}: {
  center: Coordinate
  sourceSelectable: boolean
  onSourceSelect: (point: Coordinate) => void
  floodScenario: FloodSimulationResponse | null
  landslidePath: Coordinate[]
  landslideCells: { id: string; latitude: number; longitude: number; riskScore: number; riskClass: 'low' | 'moderate' | 'high' }[]
  landslideRisk: number
  settlements: ScenarioSettlement[]
  affectedSettlementIds: Set<string>
  candidates: LowerRiskCandidate[]
  earthquakes: Earthquake[]
  incidents: Incident[]
  layers: ScenarioMapLayers
  onFeatureSelect: (feature: MapFeature) => void
}) {
  const riskCells = floodScenario?.cells ?? []
  const floodPath = floodScenario?.propagation_path ?? []
  const showAffected = layers.affectedPopulation

  return (
    <MapContainer center={center} zoom={11} scrollWheelZoom className="h-full w-full">
      <FollowCenter center={center} />
      <StartLocationPicker enabled={sourceSelectable} onSelect={onSourceSelect} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <CircleMarker center={center} radius={10} pathOptions={{ color: '#162c43', fillColor: '#fff', fillOpacity: 1, weight: 3 }}>
        <Popup>SIMULATED SCENARIO START · selected manually. Not an observed hazard source.</Popup>
      </CircleMarker>

      {layers.floodRisk && riskCells.map(cell => {
        const color = riskColor(cell.risk_class)
        return <Circle key={cell.id} center={[cell.latitude, cell.longitude]} radius={2300}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.24, weight: 1 }}>
          <Popup>
            SIMULATED FLOOD RISK · {cell.risk_class.toUpperCase()}<br />
            {cell.id} · score {cell.risk_score.toFixed(2)} (uncalibrated synthetic score, not probability)
          </Popup>
        </Circle>
      })}
      {layers.floodPath && floodPath.length > 1 && (
        <>
          <Polyline positions={floodPath} pathOptions={{ color: '#c7352b', weight: 26, opacity: 0.2, lineCap: 'round' }}>
            <Popup>Simulated flood corridor · deterministic south-east grid rule; not a hydrological flow prediction.</Popup>
          </Polyline>
          <Polyline positions={floodPath} pathOptions={{ color: '#a92724', weight: 4, dashArray: '8 7', lineCap: 'round' }}>
            <Popup>Illustrative flood propagation direction · not a real-world forecast.</Popup>
          </Polyline>
        </>
      )}
      {layers.landslideZones && landslidePath.length > 1 && (
        <>
          <Polyline positions={landslidePath} pathOptions={{ color: '#b36624', weight: 30, opacity: 0.25, lineCap: 'round' }}>
            <Popup>SIMULATED LANDSLIDE SCENARIO — DEMONSTRATION ONLY. Deterministic downslope illustration.</Popup>
          </Polyline>
          <Polyline positions={landslidePath} pathOptions={{ color: '#99521f', weight: 4, dashArray: '5 7', lineCap: 'round' }}>
            <Popup>Illustrative downslope direction, not a validated landslide prediction.</Popup>
          </Polyline>
          {landslideCells.map(cell => {
            const color = riskColor(cell.riskClass)
            return <Circle key={cell.id} center={[cell.latitude, cell.longitude]} radius={2100}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.34, weight: 2 }}>
              <Popup>
                Synthetic landslide grid cell · {cell.riskClass.toUpperCase()}<br />
                Deterministic demonstration score: {cell.riskScore.toFixed(2)} / {landslideRisk.toFixed(2)} starting score
              </Popup>
            </Circle>
          })}
        </>
      )}
      {showAffected && settlements.map(settlement => {
        const affected = affectedSettlementIds.has(settlement.id)
        const color = affected ? '#bd3029' : '#167da2'
        return <CircleMarker key={settlement.id} center={[settlement.latitude, settlement.longitude]} radius={affected ? 9 : 7}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.92, weight: 2 }}
          eventHandlers={{ click: () => onFeatureSelect({
            id: settlement.id,
            label: `Simulated settlement · ${settlement.name}`,
            description: `${settlement.population.toLocaleString()} illustrative people${affected ? ' · intersects this demonstration corridor' : ' · outside this demonstration corridor'}. This is fictional data.`,
            latitude: settlement.latitude,
            longitude: settlement.longitude,
          }) }}>
          <Popup>{settlement.name} · fictional population {settlement.population.toLocaleString()} · {affected ? 'inside illustrative corridor' : 'outside illustrative corridor'}</Popup>
        </CircleMarker>
      })}
      {layers.lowerRiskLocations && candidates.map(candidate => {
        const color = candidate.recommended ? '#218364' : '#787b80'
        return <CircleMarker key={candidate.id} center={[candidate.latitude, candidate.longitude]} radius={8}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.92, weight: 2 }}
          eventHandlers={{ click: () => onFeatureSelect({
            id: candidate.id,
            label: `Potentially lower-risk demonstration location · ${candidate.name}`,
            description: candidate.reason,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
          }) }}>
          <Popup>
            {candidate.name}<br />
            {candidate.recommended ? 'Potentially lower-risk demonstration location — not guaranteed safe' : candidate.reason}<br />
            {candidate.distanceKm.toFixed(1)} km from affected area · illustrative risk {candidate.riskScore.toFixed(2)}
          </Popup>
        </CircleMarker>
      })}
      {layers.earthquakes && earthquakes.map(event => (
        <CircleMarker key={event.id} center={[event.latitude, event.longitude]} radius={event.magnitude !== null && event.magnitude >= 4 ? 8 : 6}
          pathOptions={{ color: '#55379a', fillColor: '#7854c8', fillOpacity: 0.85, weight: 2 }}>
          <Popup>
            USGS external observation · M{event.magnitude ?? 'unknown'}<br />
            {event.place} · {new Date(event.time).toLocaleString()}<br />
            <a href={event.url} target="_blank" rel="noreferrer">Open original USGS event</a>
          </Popup>
        </CircleMarker>
      ))}
      {layers.citizenReports && incidents.filter(
        (incident): incident is Incident & { latitude: number; longitude: number } =>
          incident.latitude !== null && incident.longitude !== null,
      ).map(incident => (
        <CircleMarker key={incident.id} center={[incident.latitude, incident.longitude]} radius={8}
          pathOptions={{ color: '#a72828', fillColor: '#eb6550', fillOpacity: 0.88, weight: 2 }}
          eventHandlers={{ click: () => onFeatureSelect({
            id: incident.id,
            label: `Unverified citizen report · ${incident.incident_type}`,
            description: `${incident.severity} · ${incident.manual_location || 'Location not provided'} · API report; verify independently.`,
            latitude: incident.latitude,
            longitude: incident.longitude,
          }) }}>
          <Popup>Unverified citizen report · {incident.severity}<br />{incident.incident_type}</Popup>
        </CircleMarker>
      ))}
      {layers.fictionalResources && [
        { id: 'resource-1', name: 'High-clearance vehicle · fictional', latitude: center[0] - 0.03, longitude: center[1] - 0.08 },
        { id: 'resource-2', name: 'Medical support team · fictional', latitude: center[0] + 0.03, longitude: center[1] + 0.12 },
        { id: 'resource-3', name: 'Portable water unit · fictional', latitude: center[0] + 0.05, longitude: center[1] - 0.04 },
      ].map(resource => (
        <CircleMarker key={resource.id} center={[resource.latitude, resource.longitude]} radius={7}
          pathOptions={{ color: '#19558c', fillColor: '#4289c7', fillOpacity: 0.92, weight: 2 }}>
          <Popup>{resource.name} · not a real dispatch resource</Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
