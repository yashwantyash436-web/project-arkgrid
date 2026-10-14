import { useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMapEvents } from 'react-leaflet'
import { incidents, type Incident } from '../data/demoData'

function AreaSelector({ onPoint }: { onPoint: (lat: number, lng: number) => void }) { useMapEvents({ click: (event) => onPoint(event.latlng.lat, event.latlng.lng) }); return null }

export function MapView({ center, zoom, onAreaSelect, markers = true }: { center: [number, number]; zoom: number; onAreaSelect: (lat: number, lng: number) => void; markers?: boolean }) {
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
          <CircleMarker key={incident.id} center={[incident.lat, incident.lng]} radius={8}
            pathOptions={{ color: incident.severity === 'Critical' ? '#b42318' : '#c27a18', fillOpacity: 0.85 }}>
            <Popup><strong>{incident.title}</strong><br />{incident.id} — SIMULATED</Popup>
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
