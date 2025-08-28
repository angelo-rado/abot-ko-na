// src/app/(main)/GlobalMembershipEnsurer.tsx
'use client'
import { useEnsureFamilyMembership } from '@/lib/hooks/useEnsureFamilyMembership'
import { useAuth } from '@/lib/useAuth'
import { useSelectedFamily } from '@/lib/selected-family'

export default function GlobalMembershipEnsurer() {
  const { user } = useAuth()
  const { familyId } = useSelectedFamily()
  const name =
    (user as any)?.displayName ??
    (user as any)?.name ??
    (user as any)?.email ??
    null
  useEnsureFamilyMembership(
    familyId,
    user?.uid ?? null,
    { name, photoURL: (user as any)?.photoURL ?? null }
  )
  return null
}
