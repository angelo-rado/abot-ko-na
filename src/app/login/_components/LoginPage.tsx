'use client'

import { Button } from '@/components/ui/button'
import { auth, provider, firestore } from '@/lib/firebase'
import { signInWithPopup } from 'firebase/auth'
import { useEffect, useRef, useState } from 'react'
import { FcGoogle } from 'react-icons/fc'
import { HomeIcon, MapPinIcon, PackageIcon, ShieldIcon, Loader2 } from 'lucide-react'
import Providers from '@/app/providers'
import { useAuth } from '@/lib/useAuth'
import { useRouter, useSearchParams } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'

const FEATURES = [
  { title: 'Auto Presence', description: 'Automatically show when you’re home or away.', icon: MapPinIcon },
  { title: 'Delivery Tracker', description: 'Log who received a package and when.', icon: PackageIcon },
  { title: 'House View', description: 'See who’s home right now, at a glance.', icon: HomeIcon },
  { title: 'Private & Secure', description: 'Your data stays in your family group.', icon: ShieldIcon },
]

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading } = useAuth()

  const [loading, setLoading] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [redirect, setRedirect] = useState<string | null>(null)
  const [invite, setInvite] = useState<string | null>(null)
  const redirectedRef = useRef(false)

  useEffect(() => {
    setRedirect(searchParams.get('redirect'))
    setInvite(searchParams.get('invite'))
  }, [searchParams])

  useEffect(() => {
    if (authLoading) return
    if (!user) return
    if (redirect === null && invite === null) return
    if (redirectedRef.current) return

    const go = async () => {
      redirectedRef.current = true
      setRedirecting(true)
      try {
        const snap = await getDoc(doc(firestore, 'users', user.uid))
        const data = snap.data()
        if (data?.onboardingComplete) {
          if (redirect) {
            router.replace(redirect)
          } else if (invite) {
            router.replace(`/family/join?invite=${encodeURIComponent(invite)}&autoJoin=1`)
          } else {
            router.replace('/')
          }
        } else {
          if (invite) {
            router.replace(`/family/join?invite=${encodeURIComponent(invite)}&autoJoin=1`)
          } else {
            router.replace('/onboarding')
          }
        }
      } finally {
        setTimeout(() => setRedirecting(false), 800)
      }
    }

    go()
  }, [authLoading, user, redirect, invite, router])

  async function handleLogin() {
    setLoading(true)
    try {
      await signInWithPopup(auth, provider)
    } catch (err) {
      console.error('Login failed:', err)
      setLoading(false)
    }
  }

  const busy = loading || redirecting

  return (
    <Providers>
      <main className="min-h-screen flex items-center justify-center bg-background text-foreground px-6">
        <div className="space-y-8 text-center max-w-md w-full">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome to Abot Ko Na
            </h1>
            <p className="text-sm text-muted-foreground">
              A smart dashboard for families to stay in sync.
            </p>
          </div>

          <div>
            <Button
              type="button"
              onClick={handleLogin}
              variant="outline"
              disabled={busy}
              className="w-full h-11 gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{redirecting ? 'Redirecting…' : 'Signing in…'}</span>
                </>
              ) : (
                <>
                  <FcGoogle className="w-5 h-5" />
                  <span>Sign in with Google</span>
                </>
              )}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            {FEATURES.map(({ title, description, icon: Icon }) => (
              <div key={title} className="flex gap-3 items-start p-3 rounded-lg border bg-card text-card-foreground">
                <div className="mt-0.5"><Icon className="w-4 h-4 text-muted-foreground" /></div>
                <div>
                  <p className="text-sm font-medium leading-none">{title}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground mt-6">
            Your presence and location data stays within your family group.
          </p>
        </div>
      </main>
    </Providers>
  )
}

