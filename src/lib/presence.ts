// lib/presence.ts
import { serverTimestamp } from 'firebase/firestore';
import { db } from './db';
import { User } from 'firebase/auth';

export async function updatePresence(
  user: User,
  status: 'home' | 'away',
  auto = false
) {
  if (!user?.uid || !user?.displayName) return;

  await db.presences.put({
    id: user.uid,
    name: user.displayName,
    status,
    updatedAt: Date.now(),
    auto,
  });
}
