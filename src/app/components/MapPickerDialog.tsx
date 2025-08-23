'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  useMapEvents
} from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import L from 'leaflet';
import GeoSearch from './GeoSearch';
import { toast } from 'sonner';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default as any).prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

const customRedIcon = L.icon({
  iconUrl: '/leaflet/marker-icon-red.png',
  shadowUrl: '/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (lat: number, lon: number) => void;
  initialLat?: number;
  initialLon?: number;
};

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

export default function MapPickerDialog({
  open,
  onClose,
  onConfirm,
  initialLat,
  initialLon,
}: Props) {
  const [position, setPosition] = useState<[number, number]>(defaultPosition);
  const [tempPosition, setTempPosition] = useState<[number, number] | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (initialLat && initialLon) {
      setPosition([initialLat, initialLon]);
    }
  }, [initialLat, initialLon]);

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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent aria-describedby={undefined} className="max-w-3xl w-full">
        <DialogHeader>
          <DialogTitle>Pick Home Location</DialogTitle>
        </DialogHeader>

        <div className="relative">
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
            <GeoSearch onSelectLocation={(lat, lon) => setTempPosition([lat, lon])} />
            <FlyToLocation position={position} />

            {/* Default marker (current family home) */}
            <Marker position={position} />

            {/* New selection (temp) */}
            {tempPosition && (
              <Marker position={tempPosition} icon={customRedIcon} />
            )}

            <LocationUpdater
              onMove={(lat, lon) => setTempPosition([lat, lon])}
            />
          </MapContainer>

          {/* Confirm Button */}
          {tempPosition && (
            <div className="absolute bottom-4 right-4 z-[1000]">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onConfirm(tempPosition[0], tempPosition[1]);
                }}
              >
                Confirm Location
              </Button>
            </div>
          )}
        </div>

        <div className="text-right mt-2">
          <Button variant="outline" size="sm" onClick={flyToCurrentLocation}>
            Go to Current Location
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

