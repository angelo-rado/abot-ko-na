// src/lib/models/family.ts
//
// Centralized, typed model for a family's home location.
//
// Home location has been stored in several shapes over time:
//   - Firestore GeoPoint:        { latitude, longitude }
//   - object:                    { lat, lng } or { lat, lon }
//   - GeoJSON-ish array:         { coordinates: [lon, lat] }
//   - flattened legacy fields:   homeLat / homeLng / homeLon
//
// These helpers collapse all of those into one detection + extraction path.
// Behavior matches what was previously inlined in the home page.

export interface HomeLocation {
  lat: number
  lng: number
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

/** Extract a {lat,lng} from any single geo-shaped object, or null. */
function geoFromObject(value: unknown): HomeLocation | null {
  const obj = asRecord(value)
  if (!obj) return null

  if (isNum(obj.latitude) && isNum(obj.longitude)) {
    return { lat: obj.latitude, lng: obj.longitude }
  }
  if (isNum(obj.lat) && isNum(obj.lng)) {
    return { lat: obj.lat, lng: obj.lng }
  }
  if (isNum(obj.lat) && isNum(obj.lon)) {
    return { lat: obj.lat, lng: obj.lon }
  }
  if (Array.isArray(obj.coordinates) && isNum(obj.coordinates[1]) && isNum(obj.coordinates[0])) {
    return { lat: obj.coordinates[1], lng: obj.coordinates[0] }
  }
  return null
}

/**
 * Resolve a family's home location across every legacy shape, or null.
 * Checks `homeLocation`, `home`, `location`, then flattened homeLat/homeLng/homeLon.
 */
export function getHomeLocation(familyDoc: Record<string, unknown> | null | undefined): HomeLocation | null {
  if (!familyDoc) return null

  const fromNested =
    geoFromObject(familyDoc.homeLocation) ??
    geoFromObject(familyDoc.home) ??
    geoFromObject(familyDoc.location)
  if (fromNested) return fromNested

  const lat = familyDoc.homeLat
  const lng = familyDoc.homeLng ?? familyDoc.homeLon
  if (isNum(lat) && isNum(lng)) return { lat, lng }

  return null
}

/** True when the family has a usable home location in any supported shape. */
export function hasHomeLocation(familyDoc: Record<string, unknown> | null | undefined): boolean {
  return getHomeLocation(familyDoc) !== null
}
