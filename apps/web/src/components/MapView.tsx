import { CircleMarker, MapContainer, Popup, TileLayer, useMapEvents } from 'react-leaflet'
import { incidents, type Incident } from '../data/demoData'

function AreaSelector({ onPoint }: { onPoint: (lat: number, lng: number) => void }) { useMapEvents({ click: (event) => onPoint(event.latlng.lat, event.latlng.lng) }); return null }

export function MapView({ center, zoom, onAreaSelect, markers = true }: { center: [number, number]; zoom: number; onAreaSelect: (lat: number, lng: number) => void; markers?: boolean }) {
  return <MapContainer key={`${center[0]}-${center[1]}`} center={center} zoom={zoom} scrollWheelZoom className="rounded-xl"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><AreaSelector onPoint={onAreaSelect} />{markers && incidents.map((incident: Incident) => <CircleMarker key={incident.id} center={[incident.lat, incident.lng]} radius={8} pathOptions={{ color: incident.severity === 'Critical' ? '#b42318' : '#c27a18', fillOpacity: 0.85 }}><Popup><strong>{incident.title}</strong><br />{incident.id} — SIMULATED</Popup></CircleMarker>)}</MapContainer>
}
