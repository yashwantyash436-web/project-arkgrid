import { useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMapEvents } from 'react-leaflet'
import { incidents, type Incident } from '../data/demoData'
import type { Earthquake } from '../api/types'

function AreaSelector({ onPoint }: { onPoint: (lat: number, lng: number) => void }) { useMapEvents({ click: (event) => onPoint(event.latlng.lat, event.latlng.lng) }); return null }

export function MapView({
  center,
  zoom,
  onAreaSelect,
  markers = true,
  earthquakes = [],
  showEarthquakes = true,
  selectedEarthquakeId,
  onEarthquakeSelect,
  selectedDemoIncidentId,
  onDemoIncidentSelect,
}: {
  center: [number, number]
  zoom: number
  onAreaSelect: (lat: number, lng: number) => void
  markers?: boolean
  earthquakes?: Earthquake[]
  showEarthquakes?: boolean
  selectedEarthquakeId?: string
  onEarthquakeSelect?: (earthquake: Earthquake) => void
  selectedDemoIncidentId?: string
  onDemoIncidentSelect?: (incident: Incident) => void
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
        {markers && incidents.map((incident: Incident) => (
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
            pathOptions={{ color: '#6d28d9', fillColor: '#8b5cf6', fillOpacity: 0.8, weight: selectedEarthquakeId === event.id ? 4 : 2 }}
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
