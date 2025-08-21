'use client'
import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

export default function JoinedToastOnce() {
  const router = useRouter()
  const sp = useSearchParams()
  const firedRef = useRef(false)
  const joined = sp.get('joined') === '1'

  useEffect(() => {
    if (!joined || firedRef.current) return
    firedRef.current = true
    toast.success('Joined family!')

    // strip the param so it never re-triggers
    const url = new URL(window.location.href)
    url.searchParams.delete('joined')
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false })
  }, [joined, router])

  return null
}
