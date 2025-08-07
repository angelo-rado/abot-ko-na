'use client'

import { Suspense } from 'react'
import { LoginWithRedirect } from './_components/LoginWithRedirect'

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-center mt-10">Loading login...</p>}>
      <LoginWithRedirect />
    </Suspense>
  )
}
