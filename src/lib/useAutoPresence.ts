// src/lib/useAutoPresence.ts
'use client'

import { useEffect, useRef } from 'react'
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from './useAuth'

// Optional Dexie import — only used if you have db implemented.
// If you don't have it, the import can be removed safely.
import { db } from '@/lib/db' // << optional; remove if you don't use Dexie

const DISTANCE_THRESHOLD_METERS = 150
const POLL_INTERVAL_MS = 60_000 // 1 minute; adjust if you want faster/slower checks
const GEO_GET_TIMEOUT = 10_000

function toNumber(v: unknown) {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v !== '') return Number(v)
  return undefined
}

function getDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180
  const R = 6371e3
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * useAutoPresence(familyId)
 *
 * - listens to families/{familyId}/members/{uid} and only starts geo checks if statusSource === 'geo'
 * - respects manualLockUntil
 * - before writing, reads the member doc and only writes if status/statusSource would change
 */
export function useAutoPresence(familyId?: string | null) {
  const { user } = useAuth()
  const cancelledRef = useRef(false)
  const intervalRef = useRef<number | null>(null)
  const memberUnsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  useEffect(() => {
    // cleanup any previous subscription/interval
    if (memberUnsubRef.current) {
      try { memberUnsubRef.current() } catch {}
      memberUnsubRef.current = null
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (!user) {
      console.debug('[useAutoPresence] no user — skipping auto presence')
      return
    }
    if (!familyId) {
      console.debug('[useAutoPresence] no familyId — skipping auto presence')
      return
    }
    cancelledRef.current = false

    const memberRef = doc(firestore, 'families', familyId, 'members', user.uid)
    const famRef = doc(firestore, 'families', familyId)

    // Resolve home location (from Firestore primary, fallback Dexie)
    const getHomeFromFirestore = async (): Promise<{ lat: number; lng: number } | null> => {
      try {
        const snap = await getDoc(famRef)
        if (!snap.exists()) return null
        const data = snap.data() as any
        if (data?.homeLat !== undefined && data?.homeLon !== undefined) {
          const lat = toNumber(data.homeLat)
          const lng = toNumber(data.homeLon)
          if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng }
        }
        if (data?.homeLocation?.lat !== undefined && data?.homeLocation?.lng !== undefined) {
          const lat = toNumber(data.homeLocation.lat)
          const lng = toNumber(data.homeLocation.lng)
          if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng }
        }
        return null
      } catch (err) {
        console.warn('[useAutoPresence] failed to read family home location from Firestore', err)
        return null
      }
    }

    const getHomeLocation = async (): Promise<{ lat: number; lng: number } | null> => {
      const fromFirestore = await getHomeFromFirestore()
      if (fromFirestore) {
        try {
          if (db && typeof db.homeLocation !== 'undefined') {
            await db.homeLocation.put({
              id: familyId,
              lat: fromFirestore.lat,
              lng: fromFirestore.lng,
            })
            console.debug('[useAutoPresence] seeded local cache (Dexie) with homeLocation for', familyId)
          }
        } catch (err) {
          console.warn('[useAutoPresence] failed to seed Dexie homeLocation', err)
        }
        return fromFirestore
      }

      try {
        if (db && typeof db.homeLocation !== 'undefined') {
          const local = await db.homeLocation.get(familyId)
          if (local) {
            console.debug('[useAutoPresence] using cached Dexie homeLocation for', familyId, local)
            return local
          }
        }
      } catch (err) {
        console.warn('[useAutoPresence] Dexie read failed', err)
      }
      return null
    }

    // core check: runs the geolocation + conditional write (only on real change)
    const runCheck = async () => {
      if (cancelledRef.current) return

      // Read member doc first to check statusSource and manualLockUntil
      let memberData: any = {}
      try {
        const memberSnap = await getDoc(memberRef)
        memberData = memberSnap.exists() ? (memberSnap.data() as any) : {}
        const memberSource = memberData?.statusSource ?? null
        const manualLockUntil = Number(memberData?.manualLockUntil ?? 0)

        if (memberSource !== 'geo') {
          console.debug('[useAutoPresence] member.statusSource !== "geo" — skipping geo check', { memberSource })
          return
        }
        if (Date.now() < manualLockUntil) {
          console.debug('[useAutoPresence] manualLockUntil active — skipping geo check', { manualLockUntil })
          return
        }
      } catch (err) {
        console.warn('[useAutoPresence] failed to read member before geo check', err)
        // be conservative: skip if we can't read member doc
        return
      }

      // Resolve the home location
      const home = await getHomeLocation()
      if (!home) {
        console.debug('[useAutoPresence] no home location — skipping geolocation')
        return
      }

      if (!navigator?.geolocation) {
        console.warn('[useAutoPresence] navigator.geolocation not available')
        return
      }

      // get position
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelledRef.current) return
          const { latitude, longitude } = pos.coords
          const distance = getDistanceInMeters(latitude, longitude, home.lat, home.lng)
          const status: 'home' | 'away' = distance < DISTANCE_THRESHOLD_METERS ? 'home' : 'away'
          console.debug('[useAutoPresence] geo check result', { latitude, longitude, distance, status })

          // re-read member doc before writing to avoid races and decide if write is needed
          try {
            const preSnap = await getDoc(memberRef)
            const preData = preSnap.exists() ? (preSnap.data() as any) : {}
            const preSource = preData?.statusSource ?? null
            const preLockUntil = Number(preData?.manualLockUntil ?? 0)
            const preStatus = preData?.status ?? null

            // If source changed away from geo or lock is active, abort
            if (preSource !== 'geo') {
              console.debug('[useAutoPresence] aborting write: member.statusSource changed (preSource=%o)', preSource)
              return
            }
            if (Date.now() < preLockUntil) {
              console.debug('[useAutoPresence] aborting write: manualLockUntil active (preLockUntil=%o)', preLockUntil)
              return
            }

            // If nothing would change (status and statusSource same), skip the write
            const intendedSource = 'geo'
            if (preStatus === status && preSource === intendedSource) {
              console.debug('[useAutoPresence] skipping write because status+source unchanged', { preStatus, status, preSource })
              return
            }
          } catch (err) {
            console.warn('[useAutoPresence] failed to re-read member before geo write', err)
            // conservative: skip write if we can't read
            return
          }

          // optional: local Dexie write
          try {
            if (db && typeof db.presences !== 'undefined') {
              await db.presences.put({
                id: user.uid,
                name: (user as any).name ?? (user as any).displayName ?? 'Unknown',
                status,
                updatedAt: Date.now(),
                auto: true,
              })
            }
          } catch (err) {
            console.warn('[useAutoPresence] failed to write local presence to Dexie', err)
          }

          // finally write to Firestore (only if we reached here)
          try {
            const writeData = {
              status,
              statusSource: 'geo',
              updatedAt: serverTimestamp(),
              name: (user as any).name ?? (user as any).displayName ?? 'Unknown',
              photoURL: (user as any).photoURL ?? null,
            }
            await setDoc(memberRef, writeData, { merge: true })
            console.debug('[useAutoPresence] Firestore write OK', { familyId, uid: user.uid, status })
          } catch (err) {
            console.error('[useAutoPresence] Firestore presence write FAILED', err)
          }
        },
        (err) => {
          console.warn('[useAutoPresence] geolocation getCurrentPosition failed', err)
        },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: GEO_GET_TIMEOUT }
      )
    }

    // subscribe to member doc: start/stop polling when statusSource changes
    const unsubMember = onSnapshot(memberRef, (snap) => {
      if (cancelledRef.current) return
      const data = snap.exists() ? (snap.data() as any) : {}
      const source = data?.statusSource ?? null
      const lock = Number(data?.manualLockUntil ?? 0)
      console.debug('[useAutoPresence] member snapshot change', { source, manualLockUntil: lock })

      // if source is 'geo' and not locked, trigger a runCheck immediately and ensure polling
      if (source === 'geo' && Date.now() >= lock) {
        runCheck().catch((e) => console.warn('[useAutoPresence] runCheck failed after member snapshot', e))
        if (!intervalRef.current) {
          intervalRef.current = window.setInterval(() => {
            runCheck().catch((e) => console.warn('[useAutoPresence] periodic runCheck failed', e))
          }, POLL_INTERVAL_MS) as unknown as number
        }
      } else {
        // stop polling if it was running
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
          console.debug('[useAutoPresence] stopped polling because member is not geo/locked')
        }
      }
    }, (err) => {
      console.warn('[useAutoPresence] member onSnapshot error', err)
    })

    memberUnsubRef.current = unsubMember

    // fallback: in case onSnapshot is slow, run once after a short delay
    const fallbackTimer = window.setTimeout(() => {
      runCheck().catch((e) => console.warn('[useAutoPresence] fallback runCheck failed', e))
    }, 1_000)

    return () => {
      cancelledRef.current = true
      try { fallbackTimer && clearTimeout(fallbackTimer) } catch {}
      if (memberUnsubRef.current) {
        try { memberUnsubRef.current() } catch {}
        memberUnsubRef.current = null
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [familyId, user?.uid])
}
