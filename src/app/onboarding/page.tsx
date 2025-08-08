'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { setDoc, doc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/lib/useAuth'
import { HomeIcon, MapPinIcon, PackageIcon, ShieldIcon } from 'lucide-react'
import Providers from '../providers'

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
        description:
            'Your location and presence data is only visible to your family. You control what’s shared',
        icon: ShieldIcon,
    },
]

export default function OnboardingPage() {
    const { user, loading } = useAuth()
    const router = useRouter()
    const searchParams = useSearchParams()
    const [step, setStep] = useState<'intro' | 'next'>('intro')
    const [locationGranted, setLocationGranted] = useState(false)
    const [checking, setChecking] = useState(true)
    const [loadingPermission, setLoadingPermission] = useState(false)

    useEffect(() => {
        if (!loading && !user) {
            router.replace('/login?redirect=/onboarding')
        }
        if (user) {
            setChecking(false)
        }
    }, [user, loading, router])

    const requestLocation = async (): Promise<boolean> => {
        return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
                () => resolve(true),
                () => resolve(false)
            )
        })
    }

    const handleAllowLocation = async () => {
        setLoadingPermission(true)
        const granted = await requestLocation()
        setLocationGranted(granted)

        if (!granted) {
            toast.error('Location access denied. You can enable it later in Settings.')
        }

        setStep('next')
        setLoadingPermission(false)
    }

    const finishOnboarding = async () => {
        if (!user?.uid) return
        try {
            await setDoc(
                doc(firestore, 'users', user.uid),
                { onboardingComplete: true },
                { merge: true }
            )

            // Add a short delay to allow Firestore propagation
            await new Promise((resolve) => setTimeout(resolve, 500))
        } catch (err) {
            console.warn('Failed to mark onboarding complete:', err)
        } finally {
            localStorage.setItem('abot:onboarded', '1')
            router.replace('/')
        }
    }

    if (checking || loading) return null

    return (
        <Providers>
            <main className="max-w-xl mx-auto p-6 space-y-10">
                {step === 'intro' && (
                    <>
                        <section className="text-center space-y-2">
                            <h1 className="text-3xl font-bold">Welcome to Abot 👋</h1>
                            <p className="text-muted-foreground text-sm">
                                Here’s a quick overview before you start.
                            </p>
                        </section>

                        <section className="grid gap-4 sm:grid-cols-2">
                            {FEATURES.map((feature) => (
                                <FeatureCard key={feature.title} {...feature} />
                            ))}
                        </section>

                        <section className="space-y-4">
                            <h2 className="text-sm font-medium">Allow Location Access</h2>
                            <p className="text-xs text-muted-foreground">
                                We’ll use this to power auto-presence and show when you’re home. You can enable this later.
                            </p>

                            <Button
                                onClick={handleAllowLocation}
                                disabled={loadingPermission}
                                className="w-full"
                            >
                                {loadingPermission ? 'Requesting…' : 'Allow Location Access'}
                            </Button>

                            <Button
                                onClick={() => setStep('next')}
                                variant="ghost"
                                className="w-full text-muted-foreground"
                            >
                                Skip for now
                            </Button>
                        </section>
                    </>
                )}

                {step === 'next' && (
                    <>
                        <section className="text-center space-y-2">
                            <h2 className="text-xl font-semibold">Next step: Join or Create Family</h2>
                            <p className="text-sm text-muted-foreground">
                                You need to join a family group to start using Abot.
                            </p>
                        </section>

                        <section className="space-y-4">
                            <Button
                                onClick={() => router.push('/family/join')}
                                className="w-full"
                            >
                                Join via Invite Link
                            </Button>
                            <Button
                                onClick={() => router.push('/family/create')}
                                variant="outline"
                                className="w-full"
                            >
                                Create a New Family
                            </Button>
                            <Button
                                onClick={finishOnboarding}
                                variant="ghost"
                                className="w-full text-muted-foreground"
                            >
                                Skip for now
                            </Button>
                        </section>
                    </>
                )}
            </main>
        </Providers>
    )
}

function FeatureCard({
    title,
    description,
    icon: Icon,
}: {
    title: string
    description: string
    icon: React.ComponentType<{ className?: string }>
}) {
    return (
        <div className="border rounded-lg p-4 flex items-start gap-4">
            <div className="p-2 bg-muted rounded-md">
                <Icon className="w-5 h-5 text-primary" />
            </div>
            <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
        </div>
    )
}
