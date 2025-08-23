'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { setDoc, doc, updateDoc, getDoc } from 'firebase/firestore'
import { enqueue, isOnline as isNetOnline } from '@/lib/offline'
import { db } from '@/lib/db'
import { firestore } from '@/lib/firebase'
import MapPickerDialog from './MapPickerDialog'
import { toast } from 'sonner'

type Props = {
  familyId: string
}

export default function SetFamilyHomeLocation({ familyId }: Props) {
  const [loading, setLoading] = useState(false)
  const [homeLat, setHomeLat] = useState<number | null>(null)
  const [homeLon, setHomeLon] = useState<number | null>(null)
  const [openMap, setOpenMap] = useState(false)

  useEffect(() => {
    const fetchLocation = async () => {
      const ref = doc(firestore, 'families', familyId)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        const data = snap.data()
        if (typeof data.homeLat === 'number' && typeof data.homeLon === 'number') {
          setHomeLat(data.homeLat)
          setHomeLon(data.homeLon)
        }
      }
    }

    fetchLocation()
  }, [familyId])

  const setCurrentLocation = async () => {
    if (!navigator.geolocation) return
    setLoading(true)

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lon = pos.coords.longitude

        try {
          const ref = doc(firestore, 'families', familyId)
          await updateDoc(ref, {
            homeLat: lat,
            homeLon: lon,
          })
          setHomeLat(lat)
          setHomeLon(lon)
          toast.success('Home location saved!')
        } catch (e) {
          console.error('Error saving location:', e)
          toast.error('Failed to save location')
        } finally {
          setLoading(false)
        }
      },
      (err) => {
        console.error('Failed to get location:', err)
        toast.error('Failed to get location')
        setLoading(false)
      },
      { enableHighAccuracy: true }
    )
  }

  
  async function saveHomeLocation(lat: number, lon: number) {
    if (!familyId) return
    if (typeof navigator !== 'undefined' && !isNetOnline()) {
      try {
        await db.homeLocation.put({ id: familyId, lat, lng: lon })
        await enqueue({ op: 'setHomeLocation', familyId, payload: { familyId, lat, lng: lon } })
        toast.success('Home location saved (offline) — will sync when online')
        return true
      } catch (e) {
        console.error('offline saveHomeLocation failed', e)
      }
    }
    try {
      await setDoc(doc(firestore, 'families', familyId), { homeLocation: { lat, lng: lon } }, { merge: true })
      toast.success('Home location saved!')
      return true
    } catch (e) {
      console.error('Error saving home location:', e)
      toast.error('Failed to save home location')
      return false
    }
  }
return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Family Home Location:</p>
        {homeLat !== null && homeLon !== null ? (
          <p className="text-sm">
            Latitude: {homeLat.toFixed(5)}, Longitude: {homeLon.toFixed(5)}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground">Not set</p>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="button" onClick={setCurrentLocation} disabled={loading}>
          {loading ? 'Saving...' : 'Use My Current Location'}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpenMap(true)}>
          Pick on Map
        </Button>
      </div>

      <MapPickerDialog
        open={openMap}
        onClose={() => setOpenMap(false)}
        onConfirm={async (lat, lon) => {
          try {
            await setDoc(
              doc(firestore, 'families', familyId),
              {
                homeLat: lat,
                homeLon: lon,
              },
              { merge: true }
            )
            setHomeLat(lat)
            setHomeLon(lon)
            toast.success('Home location saved!')
          } catch (e) {
            console.error('Error saving picked location:', e)
            toast.error('Failed to save picked location')
          } finally {
            setOpenMap(false)
          }
        }}
        initialLat={homeLat ?? 14.5995} // Manila fallback
        initialLon={homeLon ?? 120.9842}
      />
    </div>
  )
}

