'use client';

import { useEffect, useRef, useState } from 'react';
import {
    MapContainer,
    TileLayer,
    Marker,
    useMapEvents,
} from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import { useAuth } from '@/lib/useAuth';
import { db } from '@/lib/db';
import GeoSearch from './GeoSearch';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// 📍 Fix for Leaflet marker issues
delete (L.Icon.Default as any).prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: '/leaflet/marker-icon-2x.png',
    iconUrl: '/leaflet/marker-icon.png',
    shadowUrl: '/leaflet/marker-shadow.png',
});

const customRedIcon = L.icon({
    iconUrl: '/leaflet/marker-icon-red.png', // make sure this exists in /public
    shadowUrl: '/leaflet/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
});

const defaultPosition: [number, number] = [14.5995, 120.9842]; // Manila

function LocationUpdater({ onMove }: { onMove: (lat: number, lon: number) => void }) {
    useMapEvents({
        click(e) {
            onMove(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
}

function FlyToLocation({ position }: { position: [number, number] }) {
    const map = useMapEvents({});
    useEffect(() => {
        map.flyTo(position, 16);
    }, [position.toString()]);
    return null;
}

export default function HomeLocationMap() {
    const { user } = useAuth();
    const [position, setPosition] = useState<[number, number] | null>(null);
    const [tempPosition, setTempPosition] = useState<[number, number] | null>(null);
    const mapRef = useRef<LeafletMap | null>(null);

    useEffect(() => {
        if (!user) return;
        db.settings.get(user.uid).then((settings) => {
            if (settings?.homeLat && settings?.homeLon) {
                setPosition([settings.homeLat, settings.homeLon]);
            } else {
                setPosition(defaultPosition);
            }
        });
    }, [user]);

    const updateHome = async (lat: number, lon: number) => {
        if (!user) return;
        setPosition([lat, lon]);
        setTempPosition(null);
        await db.settings.put({
            id: user.uid,
            autoPresence: true,
            homeLat: lat,
            homeLon: lon,
        });
        toast.success('Home location updated');
    };

    const flyToCurrentLocation = () => {
        if (!navigator.geolocation || !mapRef.current) {
            toast.error('Geolocation not supported or map not ready');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                mapRef.current?.flyTo([lat, lon], 16);
            },
            (err) => {
                console.error('Could not get location', err);
                toast.error('Failed to get current location');
            },
            { enableHighAccuracy: true }
        );
    };

    if (!position) {
        return <p className="text-center text-muted-foreground">Loading map...</p>;
    }

    return (
        <div className="relative space-y-2">
            <MapContainer
                center={position}
                zoom={16}
                scrollWheelZoom
                className="h-[400px] rounded-lg z-0"
                ref={(ref) => {
                    if (ref) {
                        const mapInstance = ref as LeafletMap;
                        mapRef.current = mapInstance;
                    }
                }}
            >
                <TileLayer
                    attribution="&copy; OpenStreetMap contributors"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <GeoSearch onSelectLocation={updateHome} />
                <FlyToLocation position={position} />

                {/* Saved Home Pin */}
                <Marker position={position} />

                {/* Temporary Selection Pin */}
                {tempPosition && (
                    <Marker position={tempPosition} icon={customRedIcon} />
                )}

                <LocationUpdater onMove={(lat, lon) => setTempPosition([lat, lon])} />
            </MapContainer>

            {/* Save button only when temp position exists */}
            {tempPosition && (
                <div className="absolute bottom-4 right-4 z-[1000]">
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => updateHome(tempPosition[0], tempPosition[1])}
                    >
                        Set this as home location
                    </Button>
                </div>
            )}

            <div className="text-right">
                <Button type="button" variant="outline" size="sm" onClick={flyToCurrentLocation}>
                    Go to Current Location
                </Button>
            </div>
        </div>
    );
}

