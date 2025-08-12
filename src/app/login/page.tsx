import { Suspense } from 'react'
import LoginPage from './_components/LoginPage'

export const dynamic = 'force-dynamic'

export default function LoginRoute() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Loading…</div>}>
      <LoginPage />
    </Suspense>
  )
}
