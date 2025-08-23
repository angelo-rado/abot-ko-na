/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/db.ts
import Dexie, { Table } from 'dexie'

export interface Presence {
  id: string // typically `${familyId}:${userId}`
  familyId: string
  userId: string
  status?: 'home' | 'away' | 'unknown'
  lat?: number
  lng?: number
  accuracy?: number
  updatedAt: number
}

export interface Delivery {
  // Dexie PK is still auto-increment under the hood; we keep this loose
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

    // v4 — add a secondary index for Firestore docId on deliveries (safe)
    this.version(4).stores({
      deliveries: '++id, docId, familyId, type, eta',
    })
  }
}

export const db = new AbotKoNaDB()

export async function ensureDbOpen(): Promise<void> {
  if (!db.isOpen()) await db.open()
}
