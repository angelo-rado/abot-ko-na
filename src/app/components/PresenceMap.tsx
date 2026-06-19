'use client'

import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'

// Leaflet's default marker asset paths break under bundlers — point them at /public.
delete (L.Icon.Default as unknown as { prototype: { _getIconUrl?: unknown } }).prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
})

const homeIcon = L.icon({
  iconUrl: '/leaflet/marker-icon-red.png',
  shadowUrl: '/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

export type PresenceMember = {
  uid: string
  name: string
  status: 'home' | 'away' | null
  lat: number
  lng: number
  updatedAt: number | null
}

/** Frame the map to show home + all member pins. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length <= 1) {
      if (points[0]) map.setView(points[0], 16)
      return
    }
    map.fitBounds(points, { padding: [44, 44], maxZoom: 16 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points)])
  return null
}

export default function PresenceMap({
  home,
  radius,
  members,
}: {
  home: { lat: number; lng: number }
  radius: number
  members: PresenceMember[]
}) {
  const points: [number, number][] = [
    [home.lat, home.lng],
    ...members.map((m) => [m.lat, m.lng] as [number, number]),
  ]

  return (
    <MapContainer
      center={[home.lat, home.lng]}
      zoom={16}
      scrollWheelZoom={false}
      className="h-[260px] w-full rounded-2xl z-0"
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Home + its presence radius */}
      <Circle
        center={[home.lat, home.lng]}
        radius={radius}
        pathOptions={{ color: '#b45309', fillColor: '#d97706', fillOpacity: 0.08, weight: 1.5 }}
      />
      <Marker position={[home.lat, home.lng]} icon={homeIcon}>
        <Popup>🏡 Home</Popup>
      </Marker>

      {/* Members with auto-presence on */}
      {members.map((m) => (
        <Marker key={m.uid} position={[m.lat, m.lng]}>
          <Popup>
            <div className="text-sm font-medium">{m.name}</div>
            <div className="text-xs">{m.status === 'home' ? '🏠 Home' : '🚪 Out'} · Auto</div>
            {m.updatedAt && (
              <div className="text-xs opacity-70">
                Updated {formatDistanceToNow(new Date(m.updatedAt), { addSuffix: true })}
              </div>
            )}
          </Popup>
        </Marker>
      ))}

      <FitBounds points={points} />
    </MapContainer>
  )
}
