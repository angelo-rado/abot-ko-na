// lib/usePresence.ts
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';

export function usePresence(userId?: string) {
  return useLiveQuery(
    () => (userId ? db.presences.get(userId) : undefined),
    [userId]
  );
}
