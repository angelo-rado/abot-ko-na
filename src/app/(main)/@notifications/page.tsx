'use client'

import NotificationsPage from "../notifications/page"
export const dynamic = 'force-dynamic'

// Wrap instead of re-export to avoid hook-order mismatch in parallel routes.
export default function NotificationsRoute() {
  return <NotificationsPage />
}
