'use client'

import { Button } from '@/components/ui/button'
import { auth, provider } from '@/lib/firebase'
import { signInWithPopup } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { FcGoogle } from 'react-icons/fc'
import { HomeIcon, MapPinIcon, PackageIcon, ShieldIcon } from 'lucide-react'
import Providers from '../providers'
import { useAuth } from '@/lib/useAuth'
import { useRouter } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'

const FEATURES = [
  {
    title: 'Auto Presence',
    description: 'Automatically show when you’re home or away.',
    icon: MapPinIcon,
  },
  {
    title: 'Delivery Tracker',
    description: 'Log who received a package and when.',
    icon: PackageIcon,
  },
  {
    title: 'House View',
    description: 'See who’s home in real time.',
    icon: HomeIcon,
  },
  {
    title: 'Privacy First',
    description: 'Only your family can see your presence.',
    icon: ShieldIcon,
  },
]

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  // ⛳ Redirect if user is already onboarded
  useEffect(() => {
    if (authLoading || !user) return

    const checkOnboarding = async () => {
      const snap = await getDoc(doc(firestore, 'users', user.uid))
      const data = snap.data()
      if (data?.onboardingComplete) {
        router.replace('/')
      } else {
        router.replace('/onboarding')
      }
    }

    checkOnboarding()
  }, [user, authLoading, router])

  const handleLogin = async () => {
    setLoading(true)
    try {
      await signInWithPopup(auth, provider)
    } catch (err) {
      console.error('Login failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Providers>
      <main className="min-h-screen flex items-center justify-center bg-[#fdfcf9] px-6">
        <div className="space-y-8 text-center max-w-md w-full">
          {/* Title */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Welcome to Abot Ko Na</h1>
            <p className="text-sm text-muted-foreground">
              A smart dashboard for families to stay in sync.
            </p>
          </div>

          {/* Google Button */}
          <div>
            <Button
              onClick={handleLogin}
              variant="outline"
              className="w-full flex items-center gap-2 justify-center border border-gray-300 bg-white shadow-sm"
              disabled={loading}
            >
              <FcGoogle className="h-5 w-5" />
              {loading ? 'Signing in…' : 'Continue with Google'}
            </Button>
          </div>

          {/* Feature highlights */}
          <div className="grid grid-cols-2 gap-4 text-left text-sm">
            {FEATURES.map(({ title, description, icon: Icon }) => (
              <div key={title} className="flex items-start gap-3">
                <div className="p-2 bg-muted rounded-md">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Privacy note */}
          <p className="text-xs text-muted-foreground mt-6">
            Your presence and location data stays within your family group.
          </p>
        </div>
      </main>
    </Providers>
  )
}
