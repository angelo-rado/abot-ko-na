'use client'

import DeliveriesPage from '../deliveries/page'
export const dynamic = 'force-dynamic'

// Wrap instead of re-export to avoid hook-order mismatch in parallel routes.
export default function DeliveriesRoute() {
  return <DeliveriesPage />
}
