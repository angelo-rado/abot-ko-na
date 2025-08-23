'use client'

import { Button } from '@/components/ui/button'
import { auth, provider } from '@/lib/firebase'
import { signInWithPopup } from 'firebase/auth'
import { useState } from 'react'
import { FcGoogle } from 'react-icons/fc'
import { HomeIcon, MapPinIcon, PackageIcon, ShieldIcon } from 'lucide-react'

const FEATURES = [
  {
    title: 'Auto Presence',
    description: 'Your family will know when you’re home or away — automatically.',
    icon: MapPinIcon,
  },
  {
    title: 'Delivery Tracker',
    description: 'Log who received a package and when.',
    icon: PackageIcon,
  },
  {
    title: 'House View',
    description: 'See who’s home in real time with the shared dashboard.',
    icon: HomeIcon,
  },
  {
    title: 'Privacy First',
    description: 'Your location and data is only visible to your family.',
    icon: ShieldIcon,
  },
]

export default function LoginButton() {
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setLoading(true)
    try {
      await signInWithPopup(auth, provider)
      // layout handles redirect
    } catch (err) {
      console.error('Login failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-gradient-to-br from-[#fefcf9] to-[#f2f6ff]">
      <div className="space-y-8 text-center max-w-md w-full">
        {/* Branding */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Welcome to Abot Ko Na 👋</h1>
          <p className="text-muted-foreground text-sm">
            Track your family's presence, deliveries, and more — all in one dashboard.
          </p>
        </div>

        {/* Login button */}
        <div className="space-y-2">
          <Button
            type="button"
            onClick={handleLogin}
            variant="outline"
            className="w-full flex items-center gap-2 justify-center"
            disabled={loading}
          >
            <FcGoogle className="h-5 w-5" />
            {loading ? 'Signing in...' : 'Continue with Google'}
          </Button>
        </div>

        {/* Features */}
        <div className="grid grid-cols-2 gap-4 text-left text-sm mt-4">
          {FEATURES.slice(0, 2).map(({ title, description, icon: Icon }) => (
            <div key={title} className="flex items-start gap-3">
              <div className="p-2 bg-muted rounded-md">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Privacy note */}
        <p className="text-xs text-muted-foreground mt-6">
          Your presence and location data is private and shared only with your family.
        </p>
      </div>
    </main>
  )
}

