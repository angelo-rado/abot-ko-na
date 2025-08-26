'use client'

import { useEffect, useRef } from 'react'
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, firestore } from '@/lib/firebase'

type HomeLoc =
  | { latitude: number; longitude: number }      // Firestore GeoPoint-like
  | { lat: number; lng?: number; lon?: number }  // {lat,lng} or {lat,lon}
  | { coordinates: [number, number] }            // [lon, lat]
  | null

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function parseHomeLocation(d: any): { lat: number; lng: number } | null {
  if (!d) return null

  // Direct objects
  const direct: HomeLoc =
    d.homeLocation ?? d.home ?? d.location ?? null

  if (direct) {
    // GeoPoint-like
    if (isNum((direct as any).latitude) && isNum((direct as any).longitude)) {
      return { lat: (direct as any).latitude, lng: (direct as any).longitude }
    }
    // {lat,lng}/{lat,lon}
    if (isNum((direct as any).lat) && (isNum((direct as any).lng) || isNum((direct as any).lon))) {
      return { lat: (direct as any).lat, lng: (isNum((direct as any).lng) ? (direct as any).lng : (direct as any).lon) }
    }
    // [lon,lat]
    if (Array.isArray((direct as any).coordinates) && isNum((direct as any).coordinates[1]) && isNum((direct as any).coordinates[0])) {
      return { lat: (direct as any).coordinates[1], lng: (direct as any).coordinates[0] }
    }
  }

  // Legacy flat fields
  if (isNum(d?.homeLat) && (isNum(d?.homeLng) || isNum(d?.homeLon))) {
    return { lat: d.homeLat, lng: (isNum(d.homeLng) ? d.homeLng : d.homeLon) }
  }

  return null
}

// meters between two WGS84 points
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function useAutoPresence(familyId?: string | null) {
  const watchIdRef = useRef<number | null>(null)
  const homeRef = useRef<{ lat: number; lng: number; enter: number; exit: number } | null>(null)
  const lastStatusRef = useRef<'home' | 'away' | null>(null)
  const lastWriteAtRef = useRef<number>(0)
  const lastPosRef = useRef<{ lat: number; lng: number; acc?: number } | null>(null)
  const unsubFamilyRef = useRef<null | (() => void)>(null)

  const debug = () => (typeof window !== 'undefined' && localStorage.getItem('debugAutoPresence') === '1')

  // Start/stop geolocation watcher
  function startWatch() {
    if (watchIdRef.current != null) return
    if (!('geolocation' in navigator)) return

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        lastPosRef.current = { lat: latitude, lng: longitude, acc: accuracy }
        evaluate(latitude, longitude, accuracy)
      },
      (err) => {
        if (debug()) console.warn('[autoPresence] watch error', err)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15_000,
        timeout: 25_000,
      }
    )
    if (debug()) console.log('[autoPresence] watch started', watchIdRef.current)
  }

  function stopWatch() {
    if (watchIdRef.current != null && 'geolocation' in navigator) {
      try { navigator.geolocation.clearWatch(watchIdRef.current) } catch {}
      if (debug()) console.log('[autoPresence] watch stopped', watchIdRef.current)
    }
    watchIdRef.current = null
  }

  async function writeStatus(status: 'home' | 'away') {
    const user = auth.currentUser
    if (!user || !familyId) return
    const now = Date.now()
    if (now - lastWriteAtRef.current < 10_000) return // throttle 10s
    lastWriteAtRef.current = now

    const lastGeo = lastPosRef.current
      ? {
          lat: lastPosRef.current.lat,
          lng: lastPosRef.current.lng,
          accuracy: lastPosRef.current.acc ?? null,
          updatedAt: serverTimestamp(),
        }
      : null

    const ref = doc(firestore, 'families', familyId, 'members', user.uid)
    if (debug()) console.log('[autoPresence] write', { status, lastGeo })
    await setDoc(
      ref,
      {
        status,
        statusSource: 'geo',
        updatedAt: serverTimestamp(),
        autoPresence: true, // helpful for UI normalizeSource
        ...(lastGeo ? { lastGeo } : {}),
        // keep basic profile fields fresh
        uid: user.uid,
        name: (user as any)?.name ?? user.displayName ?? 'Unknown',
        photoURL: (user as any)?.photoURL ?? user.photoURL ?? null,
      },
      { merge: true }
    )
  }

  function evaluate(lat: number, lng: number, accuracy?: number) {
    const home = homeRef.current
    if (!home) return
    const d = haversine(lat, lng, home.lat, home.lng)
    const prev = lastStatusRef.current
    let next: 'home' | 'away' = 'away'

    // hysteresis: enter inside `enter` radius, leave outside `exit` radius
    if (prev === 'home') {
      next = d <= home.exit ? 'home' : 'away'
    } else {
      next = d <= home.enter ? 'home' : 'away'
    }

    if (debug()) console.log('[autoPresence] dist=', Math.round(d), 'm, prev=', prev, 'next=', next, 'acc=', accuracy)

    if (next !== prev) {
      lastStatusRef.current = next
      void writeStatus(next)
    }
  }

  // Listen to family home location; recompute when it changes
  useEffect(() => {
    // clean previous
    if (unsubFamilyRef.current) { try { unsubFamilyRef.current() } catch {} ; unsubFamilyRef.current = null }
    stopWatch()
    homeRef.current = null
    lastStatusRef.current = null

    if (!familyId) return

    const familyDoc = doc(firestore, 'families', familyId)
    const unsub = onSnapshot(
      familyDoc,
      (snap) => {
        const data = snap.data()
        const loc = parseHomeLocation(data)
        const baseRadius = isNum(data?.homeRadiusMeters) ? Math.max(30, Math.min(1000, data.homeRadiusMeters)) : 120
        // hysteresis radii
        const enter = baseRadius
        const exit = Math.max(enter + 60, Math.round(enter * 1.5))

        if (!loc) {
          if (debug()) console.log('[autoPresence] no home location; stopping watch')
          homeRef.current = null
          stopWatch()
          return
        }

        homeRef.current = { lat: loc.lat, lng: loc.lng, enter, exit }
        if (debug()) console.log('[autoPresence] home set', homeRef.current)
        startWatch()

        // If we already have a last position, re-evaluate immediately (useful right after setting Home)
        const last = lastPosRef.current
        if (last) evaluate(last.lat, last.lng, last.acc)
      },
      (err) => {
        if (debug()) console.warn('[autoPresence] family doc error', err)
      }
    )
    unsubFamilyRef.current = unsub

    return () => {
      if (unsubFamilyRef.current) { try { unsubFamilyRef.current() } catch {} ; unsubFamilyRef.current = null }
      stopWatch()
    }
  }, [familyId])
}
