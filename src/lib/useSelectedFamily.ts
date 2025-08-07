// hooks/useSelectedFamily.ts
import { useEffect, useState } from 'react'

export function useSelectedFamily(defaultFamilyId: string | null) {
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('activeFamilyId')
    if (stored) {
      setFamilyId(stored)
    } else {
      setFamilyId(defaultFamilyId)
    }
    setLoading(false)
  }, [defaultFamilyId])

  const updateFamily = (id: string) => {
    localStorage.setItem('activeFamilyId', id)
    setFamilyId(id)
  }

  return { familyId, updateFamily, loading } 
}
