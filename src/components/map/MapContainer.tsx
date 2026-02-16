import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet with bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface MapContainerProps {
  center: [number, number];
  zoom?: number;
  marker?: [number, number];
  geofence?: { lat: number; lng: number; radius: number };
  patientLocation?: { lat: number; lng: number };
  patientStatus?: 'INSIDE' | 'OUTSIDE';
  onMapClick?: (lat: number, lng: number) => void;
  className?: string;
}

export function MapContainer({
  center,
  zoom = 15,
  marker,
  geofence,
  patientLocation,
  patientStatus = 'INSIDE',
  onMapClick,
  className = 'h-[400px] w-full rounded-lg',
}: MapContainerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const patientMarkerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Initialize map
    mapRef.current = L.map(containerRef.current).setView(center, zoom);

    // Add tile layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapRef.current);

    // Add click handler
    if (onMapClick) {
      mapRef.current.on('click', (e: L.LeafletMouseEvent) => {
        onMapClick(e.latlng.lat, e.latlng.lng);
      });
    }

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Update center
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView(center, zoom);
    }
  }, [center, zoom]);

  // Update home marker
  useEffect(() => {
    if (!mapRef.current) return;

    if (markerRef.current) {
      markerRef.current.remove();
    }

    if (marker) {
      const homeIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div class="flex items-center justify-center w-8 h-8 bg-primary rounded-full border-2 border-white shadow-lg">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      markerRef.current = L.marker(marker, { icon: homeIcon }).addTo(mapRef.current);
      markerRef.current.bindPopup('Home Location');
    }
  }, [marker]);

  // Update geofence circle
  useEffect(() => {
    if (!mapRef.current) return;

    if (circleRef.current) {
      circleRef.current.remove();
    }

    if (geofence) {
      circleRef.current = L.circle([geofence.lat, geofence.lng], {
        radius: geofence.radius,
        color: 'hsl(199, 89%, 48%)',
        fillColor: 'hsl(199, 89%, 48%)',
        fillOpacity: 0.15,
        weight: 2,
      }).addTo(mapRef.current);
    }
  }, [geofence]);

  // Update patient marker
  useEffect(() => {
    if (!mapRef.current) return;

    if (patientMarkerRef.current) {
      patientMarkerRef.current.remove();
    }

    if (patientLocation) {
      const isOutside = patientStatus === 'OUTSIDE';
      const patientIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div class="flex items-center justify-center w-8 h-8 ${isOutside ? 'bg-red-500' : 'bg-green-500'} rounded-full border-2 border-white shadow-lg animate-pulse">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      patientMarkerRef.current = L.marker([patientLocation.lat, patientLocation.lng], { icon: patientIcon }).addTo(mapRef.current);
      patientMarkerRef.current.bindPopup(isOutside ? 'Patient Location (Outside Safe Zone)' : 'Patient Location');
    }
  }, [patientLocation, patientStatus]);

  return <div ref={containerRef} className={className} />;
}
