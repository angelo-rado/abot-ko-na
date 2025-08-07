'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { OpenStreetMapProvider, GeoSearchControl } from 'leaflet-geosearch';
import 'leaflet-geosearch/dist/geosearch.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

interface GeoSearchProps {
  onSelectLocation?: (lat: number, lng: number) => void;
}

export default function GeoSearch({ onSelectLocation }: GeoSearchProps) {
  const map = useMap();

  useEffect(() => {
    const provider = new OpenStreetMapProvider();

    // @ts-expect-error: leaflet-geosearch constructor typing is incomplete
    const searchControl = new GeoSearchControl({
      provider,
      style: 'bar',
      showMarker: true,
      marker: {
        icon: new L.Icon.Default(),
        draggable: false,
      },
      searchLabel: 'Search location...',
      retainZoomLevel: false,
      autoClose: true,
    });

    map.addControl(searchControl);

    map.on('geosearch/showlocation', (result: any) => {
      const { y, x } = result.location;
      onSelectLocation?.(y, x);
    });

    return () => {
      map.removeControl(searchControl);
      map.off('geosearch/showlocation');
    };
  }, [map, onSelectLocation]);

  return null;
}
