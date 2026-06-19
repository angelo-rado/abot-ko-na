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

const homeDivIcon = L.divIcon({
  className: 'presence-pin',
  html:
    `<div style="width:40px;height:40px;border-radius:9999px;background:#b45309;` +
    `display:flex;align-items:center;justify-content:center;font-size:18px;` +
    `border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);">🏡</div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -22],
})

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function initialsOf(name: string): string {
  return (
    name.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?'
  )
}

/** Google-Maps-style avatar pin: photo if available, else initials chip. */
function memberIcon(m: PresenceMember): L.DivIcon {
  const ring = m.status === 'home' ? '#16a34a' : '#9ca3af'
  const inner = m.photoURL
    ? `<img src="${escapeHtml(m.photoURL)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;border-radius:9999px;" />`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;` +
      `border-radius:9999px;background:linear-gradient(135deg,#f5d0a9,#f8e4c9);color:#92400e;` +
      `font-weight:600;font-size:13px;font-family:system-ui,-apple-system,sans-serif;">${escapeHtml(initialsOf(m.name))}</div>`
  return L.divIcon({
    className: 'presence-pin',
    html:
      `<div style="width:38px;height:38px;border-radius:9999px;background:#fff;padding:2px;` +
      `box-sizing:border-box;border:2.5px solid ${ring};box-shadow:0 2px 6px rgba(0,0,0,.3);">${inner}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -20],
  })
}

export type PresenceMember = {
  uid: string
  name: string
  photoURL?: string | null
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
      <Marker position={[home.lat, home.lng]} icon={homeDivIcon}>
        <Popup>🏡 Home</Popup>
      </Marker>

      {/* Members with auto-presence on */}
      {members.map((m) => (
        <Marker key={m.uid} position={[m.lat, m.lng]} icon={memberIcon(m)}>
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
