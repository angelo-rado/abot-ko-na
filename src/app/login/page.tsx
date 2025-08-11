'use client'

import { Suspense } from 'react'
import Providers from '../providers'
import LoginPage from './_components/LoginPage'

function LoginPageWrapper() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  )
}

export default function Page() {
  return (
    <Providers>
      <LoginPageWrapper />
    </Providers>
  )
}
