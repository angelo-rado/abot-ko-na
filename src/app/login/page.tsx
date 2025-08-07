'use client'

import { auth, provider } from '@/lib/firebase'
import { signInWithPopup } from 'firebase/auth'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useEffect } from 'react'
import { useAuth } from '@/lib/useAuth'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectPath = searchParams.get('redirect') ?? '/'
  const { user } = useAuth()

  useEffect(() => {
    if (user) {
      router.replace(redirectPath)
    }
  }, [user, redirectPath])

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider)
      router.replace(redirectPath)
    } catch (err) {
      console.error('Login failed', err)
    }
  }

  return (
    <main className="h-screen flex items-center justify-center">
      <Button onClick={handleLogin}>Sign in with Google</Button>
    </main>
  )
}
