'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/useAuth';
import { db } from '@/lib/db';
import { UserSettings } from '@/lib/db';
import { useLiveQuery } from 'dexie-react-hooks';

export default function SetHomeLocation() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);

    const location = useLiveQuery<UserSettings | null>(async () => {
        if (!user) return null;
        const result = await db.settings.get(user.uid);
        return result ?? null; // convert undefined → null
    }, [user?.uid]);



    const setCurrentLocation = async () => {
        if (!user || !navigator.geolocation) return;

        setLoading(true);
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;

                await db.settings.put({
                    id: user.uid,
                    autoPresence: true, // you can preserve existing values if needed
                    homeLat: lat,
                    homeLon: lon,
                });

                setLoading(false);
            },
            (err) => {
                console.error('Failed to get location:', err);
                setLoading(false);
            },
            { enableHighAccuracy: true }
        );
    };

    return (
        <div className="space-y-4">
            <div>
                <p className="text-sm text-muted-foreground">Saved Home Location:</p>
                {location?.homeLat !== undefined && location?.homeLon !== undefined ? (
                    <p className="text-sm">
                        Latitude: {location.homeLat.toFixed(5)}, Longitude: {location.homeLon.toFixed(5)}
                    </p>
                ) : (
                    <p className="text-sm italic text-muted-foreground">Not set</p>
                )}
            </div>
            <Button type="button" onClick={setCurrentLocation} disabled={loading}>
                {loading ? 'Saving...' : 'Set Current Location as Home'}
            </Button>
        </div>
    );
}

