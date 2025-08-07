// lib/db.ts
import Dexie, { Table } from 'dexie';

export interface Presence {
  id: string; // usually user uid
  name: string;
  status: 'home' | 'away';
  updatedAt: number;
  auto: boolean; // added for geolocation support
}

export interface Delivery {
  id: string;
  for: string; // user uid or name
  type: 'COD' | 'PAID';
  amount?: number;
  eta: string;
  note?: string;
  createdAt: number;
}

export interface UserSettings {
  id: string; // user uid
  autoPresence: boolean;
  homeLat?: number;
  homeLon?: number;
}

export interface Family {
  id: string // Firestore familyId
  name: string
  createdBy: string
  createdAt: number // timestamp
}

export interface FamilyMember {
  id: string // same as Firebase UID or custom generated
  name: string
  avatarUrl?: string
  status: 'home' | 'away'
  updatedAt: number,
}

export interface HomeLocation {
  id: string; // familyId
  lat: number;
  lng: number;
}

class AbotKoNaDB extends Dexie {
  presences!: Table<Presence>;
  deliveries!: Table<Delivery>;
  settings!: Table<UserSettings>;
  families!: Table<Family, string>;
  familyMembers!: Table<FamilyMember, string>;
  homeLocation!: Table<HomeLocation, string>;

  constructor() {
    super('abotKoNa');
    this.version(1).stores({
      presences: 'id',
      deliveries: '++id, for, type, eta',
      settings: 'id', // ✅ matches the declared Table above
      families: 'id, name',
      familyMembers: 'id, name, status, lastUpdated',
      homeLocation: 'id',
    });
  }
}

export const db = new AbotKoNaDB();
