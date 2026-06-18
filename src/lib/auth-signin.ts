// src/lib/auth-signin.ts
'use client'

import { signInWithPopup, signInWithRedirect } from 'firebase/auth'
import { auth, provider } from '@/lib/firebase'

/** iOS Safari and installed PWAs block auth popups, so prefer redirect there. */
function prefersRedirect(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isMobileUA = /iPhone|iPad|iPod|Android/i.test(ua)
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    // iOS Safari "Add to Home Screen"
    (navigator as unknown as { standalone?: boolean }).standalone === true
  return isMobileUA || isStandalone
}

/**
 * Sign in with Google, robust across environments:
 * - Mobile / installed PWA  → redirect (popups are unreliable / blocked there)
 * - Desktop                 → popup, falling back to redirect if it's blocked
 *
 * On the redirect path the page navigates away to Google and back; the auth
 * state is then picked up by the onAuthStateChanged listener in useAuth.
 */
export async function signInWithGoogle(): Promise<void> {
  if (prefersRedirect()) {
    await signInWithRedirect(auth, provider)
    return
  }

  try {
    await signInWithPopup(auth, provider)
  } catch (err) {
    const code = (err as { code?: string })?.code ?? ''
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, provider)
      return
    }
    throw err
  }
}
