/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/useAutoPresence.ts
'use client'

import { useEffect, useRef } from 'react'
import { db, ensureDbOpen } from './db'
import { useAuth } from './useAuth'

type Geo = { lat?: number; lng?: number; accuracy?: number }

// Guard: detect upgrade/closed errors (incl. the "changing primary key" message)
function isDexieUpgradeError(err: any) {
  const name = String(err?.name || '')
  const msg = String(err?.message || '')
  return (
    name === 'DatabaseClosedError' ||
    msg.includes('UpgradeError') ||
    msg.includes('changing primary key')
  )
}

// One-time self-heal per tab session to stop warning spam
let healedDexie = false
async function healDexieOnUpgradeError(err: any) {
  if (!isDexieUpgradeError(err) || healedDexie) return
  try {
    healedDexie = true
    db.close()
    await db.delete() // blow away broken local schema (safe: cache)
    await db.open()   // reopen with latest schema
    // eslint-disable-next-line no-console
    console.info('[useAutoPresence] Dexie healed by delete+open due to upgrade error')
    // Kick any listeners that may want to retry
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('abot-refresh'))
    }
  } catch {
    // ignore
  }
}

/**
 * Persist / update a local presence row in Dexie.
 * Keeps legacy behavior: id is `${familyId}:${userId}`
 */
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

/**
 * Ensure a homeLocation row exists locally to avoid first-run reads throwing.
 * Uses the NEW V2 table if available; falls back to legacy table if not.
 * This does not overwrite coordinates — it only seeds a minimal record.
 */
async function seedHomeLocationIfNeeded(
  familyId: string,
  userId: string
) {
  try {
    await ensureDbOpen()

    const hasV2 = (db as any).homeLocationV2
    if (hasV2) {
      const v2 = (db as any).homeLocationV2 as any
      const existing = await v2.get([familyId, userId])
      if (!existing) {
        await v2.put({
          familyId,
          userId,
          updatedAt: Date.now(),
        })
      }
      return
    }

    // Fallback to legacy table (no PK change)
    const legacy = db.homeLocation
    const legacyId = `${familyId}:${userId}`
    const existingLegacy = await legacy.get(legacyId)
    if (!existingLegacy) {
      await legacy.put({
        id: legacyId,
        familyId,
        userId,
        updatedAt: Date.now(),
      })
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[useAutoPresence] failed to seed Dexie homeLocation', err)
    await healDexieOnUpgradeError(err)
  }
}

/**
 * Small util to request a one-time geolocation fix.
 * (We avoid long-lived watchers to keep this hook lightweight.)
 */
function getCurrentGeo(): Promise<Geo> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({})
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
      },
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    )
  })
}

/**
 * Hook: useAutoPresence
 * - Seeds local homeLocation (V2) if missing
 * - Writes a local presence row (Dexie) with a fresh timestamp (and geo if available)
 * - Self-heals Dexie if the tab has an old/broken schema (stops the console spam)
 *
 * This hook intentionally does not return state; it performs side-effects only.
 */
export function useAutoPresence(familyId?: string) {
  const { user } = useAuth()
  const loggedOnce = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function run() {
      const userId = user?.uid
      if (!familyId || !userId) return

      // Seed minimal homeLocation row so other readers don't explode on first run
      await seedHomeLocationIfNeeded(familyId, userId)

      // Best effort: capture latest geo and write a local presence snapshot
      const geo = await getCurrentGeo()
      await writeLocalPresenceDexie(
        familyId,
        userId,
        'unknown', // keep neutral; your other logic can flip to 'home'/'away'
        geo
      )
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
      void cancelled // keep TS quiet
    }
  }, [familyId, user?.uid])
}

// Also export default to be resilient to either import style
export default useAutoPresence
