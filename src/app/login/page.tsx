'use client'

import { Suspense } from 'react'
import LoginPage from './_components/LoginPage'
import Providers from '../providers'

export default function Page() {
  return (
    <Providers>
      <Suspense fallback={<div className="p-6 text-center">Loading...</div>}>
        <LoginPage />
      </Suspense>
    </Providers>
  )
}
