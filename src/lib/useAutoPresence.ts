/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/useAutoPresence.ts
'use client'

import { useEffect, useRef } from 'react'
import { db, ensureDbOpen } from './db'
import { useAuth } from './useAuth'

type Geo = { lat?: number; lng?: number; accuracy?: number }

function isDexieUpgradeError(err: any) {
  const name = String(err?.name || '')
  const msg = String(err?.message || '')
  return name === 'DatabaseClosedError' || msg.includes('UpgradeError') || msg.includes('changing primary key')
}

let healedDexie = false
async function healDexieOnUpgradeError(err: any) {
  if (!isDexieUpgradeError(err) || healedDexie) return
  try {
    healedDexie = true
    db.close()
    await db.delete()
    await db.open()
    // eslint-disable-next-line no-console
    console.info('[useAutoPresence] Dexie healed by delete+open due to upgrade error')
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('abot-refresh'))
  } catch {}
}

async function writeLocalPresenceDexie(
  familyId: string,
  userId: string,
  status: 'home' | 'away' | 'unknown',
  geo?: Geo
) {
  try {
    await ensureDbOpen()
    const id = `${familyId}:${userId}`
    await db.presences.put({
      id,
      familyId,
      userId,
      status,
      lat: geo?.lat,
      lng: geo?.lng,
      accuracy: geo?.accuracy,
      updatedAt: Date.now(),
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[useAutoPresence] failed to write local presence to Dexie', err)
    await healDexieOnUpgradeError(err)
  }
}

async function seedHomeLocationIfNeeded(familyId: string, userId: string) {
  try {
    await ensureDbOpen()
    const hasV2 = (db as any).homeLocationV2
    if (hasV2) {
      const v2 = (db as any).homeLocationV2 as any
      const existing = await v2.get([familyId, userId])
      if (!existing) {
        await v2.put({ familyId, userId, updatedAt: Date.now() })
      }
      return
    }
    const legacy = db.homeLocation
    const legacyId = `${familyId}:${userId}`
    const existingLegacy = await legacy.get(legacyId)
    if (!existingLegacy) {
      await legacy.put({ id: legacyId, familyId, userId, updatedAt: Date.now() })
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[useAutoPresence] failed to seed Dexie homeLocation', err)
    await healDexieOnUpgradeError(err)
  }
}

function getCurrentGeo(): Promise<Geo> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({})
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    )
  })
}

// ⬇️ accept string | null | undefined here
export function useAutoPresence(familyId: string | null | undefined) {
  const { user } = useAuth()
  const loggedOnce = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function run() {
      const userId = user?.uid
      // Guard: require real strings for both
      if (typeof familyId !== 'string' || !userId) return

      await seedHomeLocationIfNeeded(familyId, userId)
      const geo = await getCurrentGeo()
      await writeLocalPresenceDexie(familyId, userId, 'unknown', geo)
    }

    run().catch((err) => {
      if (!loggedOnce.current) {
        // eslint-disable-next-line no-console
        console.warn('[useAutoPresence] unexpected error', err)
        loggedOnce.current = true
      }
      healDexieOnUpgradeError(err)
    })

    return () => {
      cancelled = true
      void cancelled
    }
  }, [familyId, user?.uid])
}

export default useAutoPresence
