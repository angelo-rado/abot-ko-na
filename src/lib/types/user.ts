// types/user.ts
import { User as FirebaseUser } from 'firebase/auth'

export interface ExtendedUser extends FirebaseUser {
  status?: 'home' | 'away'
  statusSource?: 'manual' | 'geo'
  homeLocation?: {
    lat: number
    lng: number
  }
}
