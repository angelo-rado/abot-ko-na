/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/db.ts
import Dexie, { Table } from 'dexie'

export interface Presence {
  id: string                         // e.g. `${familyId}:${userId}` or just userId
  familyId?: string                  // optional to support legacy/simple callers
  userId?: string

  // fields your code writes/reads
  name?: string                      // display name
  status?: 'home' | 'away' | 'unknown'
  auto?: boolean                     // whether status was set automatically

  // optional location + freshness
  lat?: number
  lng?: number
  accuracy?: number
  updatedAt: number

  // allow future flags without breaking TS
  [k: string]: any
}

export interface Delivery {
  // Dexie PK is auto-increment under the hood; keep this loose for callers
  id?: any
  familyId: string
  for?: string
  type?: string
  eta?: number
  data?: any
  updatedAt?: number
  // Firestore document id (not the Dexie PK)
  docId?: string
}

export interface SettingRow {
  id: string
  key?: string
  value?: any
  updatedAt?: number

  // app-specific optional fields (used by your UI)
  homeLat?: number
  homeLon?: number   // longitude
  homeLng?: number   // alias for older/newer code paths
  homeRadius?: number

  // allow other dynamic settings without TS errors
  [k: string]: any
}

export interface FamilyRow {
  id: string
  name?: string
  createdBy?: string
  createdAt?: number
}

export interface FamilyMemberRow {
  id: string
  familyId: string
  name?: string
  status?: string
  lastUpdated?: number
}

/** Legacy table that once had primary key 'id' (must remain untouched). */
export interface HomeLocationLegacy {
  id: string // DO NOT change PK for this legacy table
  familyId?: string
  userId?: string
  lat?: number
  lng?: number
  radius?: number
  updatedAt?: number
}

/** New table with compound PK. Added as a new store to avoid PK-change errors. */
export interface HomeLocationV2 {
  familyId: string
  userId: string
  lat?: number
  lng?: number
  radius?: number
  updatedAt: number
}

/** Optional local outbox for sync (keep as-is if unused elsewhere). */
export interface OutboxItem {
  key?: number
  familyId: string
  op: string
  payload?: any
  ts: number
}

export interface MirrorNotification {
  id: string
  title?: string | null
  type: string
  body?: string | null
  createdAt?: string | number | Date | null
  reads?: Record<string, any> | null
  familyId?: string | null
  familyName?: string | null
  meta?: any
  _path?: string | null
  updatedAt?: number // unix ms for cache freshness
}

export interface PendingWrite {
  id?: number
  kind: 'mark-read'
  path: string
  data: Record<string, any>
  ts: number
}

export class AbotKoNaDB extends Dexie {
  presences!: Table<Presence, string>
  // Loosen typing here to avoid TS complaining in callers that pass string keys
  deliveries!: Table<any, any>
  settings!: Table<SettingRow, string>
  families!: Table<FamilyRow, string>
  familyMembers!: Table<FamilyMemberRow, string>
  homeLocation!: Table<HomeLocationLegacy, string> // legacy, keep
  homeLocationV2!: Table<HomeLocationV2, [string, string]> // new, compound key
  outbox!: Table<OutboxItem, number>
  notifications!: Table<MirrorNotification, string>
  pendingWrites!: Table<PendingWrite, number>

  constructor() {
    super('abotKoNa')

    // v1 — original stores (example baseline)
    this.version(1).stores({
      presences: 'id',
      deliveries: '++id, familyId, for, type, eta',
      settings: 'id',
      families: 'id, name',
      familyMembers: 'id, name, status, lastUpdated',
      homeLocation: 'id', // legacy: DO NOT change PK
    })

    // v2 — safe additions (indexes etc.) w/o PK changes
    this.version(2).stores({
      presences: 'id',
      deliveries: '++id, familyId, for, type, eta',
      settings: 'id',
      families: 'id, name',
      familyMembers: 'id, familyId, name, status, lastUpdated',
      homeLocation: 'id',
      outbox: '++key, familyId, op, ts',
    })

    // v3 — add NEW table with compound PK instead of altering legacy PK
    this.version(3)
      .stores({
        homeLocationV2: '[familyId+userId], familyId, userId',
      })
      .upgrade(async (tx) => {
        try {
          const legacy = tx.table('homeLocation') as Table<HomeLocationLegacy, string>
          const v2 = tx.table('homeLocationV2') as Table<HomeLocationV2, [string, string]>
          const rows = await legacy.toArray()
          if (!rows?.length) return

          const mapped = rows
            .map((r) => {
              const [famFromId, userFromId] = (r.id?.includes(':') ? r.id.split(':') : ['', r.id ?? ''])
              const familyId = r.familyId ?? famFromId
              const userId = r.userId ?? userFromId
              if (!familyId || !userId) return null
              return {
                familyId,
                userId,
                lat: r.lat,
                lng: r.lng,
                radius: r.radius,
                updatedAt: r.updatedAt ?? Date.now(),
              } as HomeLocationV2
            })
            .filter(Boolean) as HomeLocationV2[]

          if (mapped.length) await v2.bulkPut(mapped)
        } catch {
          // ignore — migration is opportunistic
        }
      })

    // v4 — add deliveries.docId index + notifications/pendingWrites stores
    this.version(4).stores({
      deliveries: '++id, docId, familyId, type, eta',
      notifications: 'id, createdAt, familyId, type, updatedAt',
      pendingWrites: '++id, kind, ts',
    })

    // v5 — add compound index for faster family scoping & time sorts (non-breaking)
    this.version(5).stores({
      // keep old indexes; add compound [familyId+createdAt] + single createdAt
      notifications: 'id, [familyId+createdAt], createdAt, familyId, type, updatedAt',
    })
  }
}

export const db = new AbotKoNaDB()

export async function ensureDbOpen(): Promise<void> {
  if (!db.isOpen()) await db.open()
}

export type UserSettings = SettingRow
export type OutboxTask = OutboxItem
