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
  { title: 'House View', description: 'See who’s home in real time.', icon: HomeIcon },
  { title: 'Privacy First', description: 'Only your family can see your presence.', icon: ShieldIcon },
]

export default function LoginPage() {
  const [loading, setLoading] = useState(false)           // during Google popup
  const [redirecting, setRedirecting] = useState(false)   // after sign-in, while routing
  const redirectedRef = useRef(false)                     // prevent double redirects

  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [redirect, setRedirect] = useState<string | null>(null)
  const [invite, setInvite] = useState<string | null>(null)

  // Read query params after hydration
  useEffect(() => {
    setRedirect(searchParams.get('redirect'))
    setInvite(searchParams.get('invite'))
  }, [searchParams])

  // Redirect after sign-in / if already signed-in
  useEffect(() => {
    if (authLoading) return
    if (!user) return
    if (redirect === null && invite === null) return       // wait for params
    if (redirectedRef.current) return

    const go = async () => {
      redirectedRef.current = true
      setRedirecting(true)                                 // keep the button busy during navigation
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
            router.replace(`/onboarding?invite=${encodeURIComponent(invite)}`)
          } else if (redirect) {
            router.replace(`/onboarding?redirect=${encodeURIComponent(redirect)}`)
          } else {
            router.replace('/onboarding')
          }
        }
      } catch (e) {
        console.error('Redirect failed:', e)
        setRedirecting(false)
        redirectedRef.current = false
      }
    }

    go()
  }, [user, authLoading, router, redirect, invite])

  const handleLogin = async () => {
    setLoading(true)
    try {
      await signInWithPopup(auth, provider)
      // Do NOT set loading=false here; let redirect effect take over (keeps button busy)
    } catch (err) {
      console.error('Login failed:', err)
      setLoading(false)       // re-enable if popup failed
    }
  }

  const busy = loading || redirecting

  return (
    <Providers>
      {/* Use theme tokens for proper dark/light contrast */}
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
              className="w-full flex items-center gap-2 justify-center border border-input bg-card text-card-foreground shadow-sm"
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {redirecting ? 'Redirecting…' : 'Signing in…'}
                </>
              ) : (
                <>
                  <FcGoogle className="h-5 w-5" />
                  Continue with Google
                </>
              )}
            </Button>
            {/* Small hint below the button */}
            {invite && !user && (
              <p className="mt-2 text-xs text-muted-foreground">
                You’ll be sent back to finish joining your family after sign-in.
              </p>
            )}
          </div>

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

          <p className="text-xs text-muted-foreground mt-6">
            Your presence and location data stays within your family group.
          </p>
        </div>
      </main>
    </Providers>
  )
}
