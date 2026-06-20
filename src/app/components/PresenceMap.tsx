'use client'

import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
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
    `<div style="width:42px;height:42px;border-radius:9999px;background:#b45309;` +
    `display:flex;align-items:center;justify-content:center;font-size:19px;` +
    `border:3px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,.28);">🏡</div>`,
  iconSize: [42, 42],
  iconAnchor: [21, 21],
  popupAnchor: [0, -23],
})

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function initialsOf(name: string): string {
  return name.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?'
}

/** Google-Maps-style avatar pin: photo if available, else initials chip. */
function memberIcon(m: PresenceMember): L.DivIcon {
  const ring = m.status === 'home' ? '#16a34a' : '#fb923c'
  const inner = m.photoURL
    ? `<img src="${escapeHtml(m.photoURL)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;border-radius:9999px;" />`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;` +
      `border-radius:9999px;background:linear-gradient(135deg,#f5d0a9,#f8e4c9);color:#92400e;` +
      `font-weight:700;font-size:14px;font-family:system-ui,-apple-system,sans-serif;">${escapeHtml(initialsOf(m.name))}</div>`
  return L.divIcon({
    className: 'presence-pin',
    html:
      `<div style="width:44px;height:44px;border-radius:9999px;background:#fff;padding:2.5px;` +
      `box-sizing:border-box;border:3px solid ${ring};box-shadow:0 3px 8px rgba(0,0,0,.28);">${inner}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -24],
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

/** Frame the map to show home + all member pins — once, so it doesn't fight panning. */
function FitBoundsOnce({ points }: { points: [number, number][] }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || points.length === 0) return
    done.current = true
    if (points.length === 1) map.setView(points[0], 16)
    else map.fitBounds(points, { padding: [48, 48], maxZoom: 16 })
  }, [points, map])
  return null
}

/** Fly to a member when the user taps "locate". */
function FlyToFocus({ target }: { target: { lat: number; lng: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 17, { duration: 0.8 })
  }, [target?.lat, target?.lng, map])
  return null
}

export default function PresenceMap({
  home,
  radius,
  members,
  focus,
}: {
  home: { lat: number; lng: number }
  radius: number
  members: PresenceMember[]
  focus?: { lat: number; lng: number } | null
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
      className="h-[320px] w-full rounded-2xl z-0 ring-1 ring-border"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />

      {/* Home + its presence radius */}
      <Circle
        center={[home.lat, home.lng]}
        radius={radius}
        pathOptions={{ color: '#b45309', fillColor: '#d97706', fillOpacity: 0.1, weight: 1.5 }}
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

      <FitBoundsOnce points={points} />
      <FlyToFocus target={focus ?? null} />
    </MapContainer>
  )
}
