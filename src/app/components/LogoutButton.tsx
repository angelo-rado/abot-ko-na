'use client'

import { Button } from '@/components/ui/button'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useRouter } from 'next/navigation'

export default function LogoutButton() {
  const router = useRouter()

  const handleLogout = async () => {
    try {
      // Clear local storage (preferredFamily, etc.)
      localStorage.removeItem('abot:selectedFamily')
      localStorage.removeItem('abot:onboarded')

      // Sign out
      await signOut(auth)

      // Push to root (login screen)
      router.push('/login')
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  return (
    <Button type="button" variant="outline" onClick={handleLogout}>
      Logout
    </Button>
  )
}
