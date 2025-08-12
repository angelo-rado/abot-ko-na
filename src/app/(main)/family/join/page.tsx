import { Suspense } from 'react'
import FamilyJoinPageContent from './FamilyJoinPageContent'

// Avoid prerender issues for client-only search params
export const dynamic = 'force-dynamic'
// Alternative if you prefer: export const fetchCache = 'force-no-store'

export default function FamilyJoinPage() {
  return (
    <Suspense fallback={<div className="max-w-xl mx-auto p-6 text-center">Loading…</div>}>
      <FamilyJoinPageContent />
    </Suspense>
  )
}
