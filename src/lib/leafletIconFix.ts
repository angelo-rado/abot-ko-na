// lib/leafletIconFix.ts
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconUrl: '/marker-icon.png',
  shadowUrl: '/marker-shadow.png',
  iconRetinaUrl: '/marker-icon.png',
});
