// lib/db.ts
import Dexie, { Table } from 'dexie'

export interface Presence {
  id: string
  name: string
  status: 'home' | 'away'
  updatedAt: number
  auto: boolean
}

export interface Delivery {
  id: string
  familyId: string
  title?: string
  for?: string
  type?: 'COD' | 'PAID' | 'single' | 'multiple'
  amount?: number | null
  note?: string
  receiverNote?: string
  eta?: number | null
  createdAt?: number
  updatedAt?: number
  itemCount?: number
  status?: string
  receivedAt?: number | null
}

export interface Setting {
  id: string
  value: any
  // legacy keys used by HomeLocationMap
  homeLat?: number
  homeLon?: number
}

export interface Family {
  id: string
  name?: string
}

export interface FamilyMember {
  id: string
  familyId: string
  name?: string
  status?: 'home' | 'away'
  lastUpdated?: number
  photoURL?: string | null
}

export interface HomeLocation {
  id: string
  lat: number
  lng: number
}

export type OutboxTask = {
  key?: number
  familyId?: string | null
  op: 'addDelivery' | 'updateDelivery' | 'deleteDelivery' | 'setHomeLocation' | 'removeMember' | 'markOrderDelivered' | 'markChildItemReceived'
  path?: string
  payload: any
  ts: number
}

export class AbotKoNaDB extends Dexie {
  presences!: Table<Presence, string>
  deliveries!: Table<Delivery, string>
  settings!: Table<Setting, string>
  families!: Table<Family, string>
  familyMembers!: Table<FamilyMember, string>
  homeLocation!: Table<HomeLocation, string>
  outbox!: Table<OutboxTask, number>

  constructor() {
    super('abotKoNa')

    this.version(1).stores({
      presences: 'id',
      deliveries: '++id, for, type, eta',
      settings: 'id',
      families: 'id, name',
      familyMembers: 'id, name, status, lastUpdated',
      homeLocation: 'id',
    })

    this.version(2).stores({
      presences: 'id',
      deliveries: 'id, familyId, for, type, eta, updatedAt',
      settings: 'id',
      families: 'id, name',
      familyMembers: 'id, familyId, name, status, lastUpdated',
      homeLocation: 'id',
      outbox: '++key, familyId, op, ts'
    }).upgrade(async (tx) => {
      try { await tx.table('deliveries').clear() } catch {}
    })
  }
}

export const db = new AbotKoNaDB()
