import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/utils';

// Fix for default marker icons in Leaflet with bundlers
const defaultIconPrototype = L.Icon.Default.prototype as L.Icon.Default & {
  _getIconUrl?: () => string;
};
delete defaultIconPrototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

type PatientStatus = 'INSIDE' | 'OUTSIDE';

interface PatientMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status?: PatientStatus;
}

interface MapContainerProps {
  center: [number, number];
  zoom?: number;
  marker?: [number, number];
  geofence?: { lat: number; lng: number; radius: number };
  patientLocation?: { lat: number; lng: number };
  patientStatus?: PatientStatus;
  patientMarkers?: PatientMarker[];
  onMapClick?: (lat: number, lng: number) => void;
  className?: string;
  enableHoverLift?: boolean;
}

const getHomeMarkerIcon = () =>
  L.divIcon({
    className: 'cc-map-icon-host',
    html: '<div class="cc-home-pin" aria-hidden="true"><span>H</span></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

const getLivePatientIcon = (isOutside: boolean) =>
  L.divIcon({
    className: 'cc-map-icon-host',
    html: `
      <div class="cc-live-pin-wrap" aria-hidden="true">
        <div class="cc-live-arrow"></div>
        <div class="cc-live-pulse ${isOutside ? 'cc-live-pulse--outside' : 'cc-live-pulse--inside'}"></div>
        <div class="cc-live-pin cc-live-pin-bounce ${isOutside ? 'cc-live-pin--outside' : 'cc-live-pin--inside'}"></div>
      </div>
    `,
    iconSize: [44, 58],
    iconAnchor: [22, 52],
  });

const getCaregiverPatientIcon = (isOutside: boolean) =>
  L.divIcon({
    className: 'cc-map-icon-host',
    html: `
      <div class="cc-caregiver-pin-wrap" aria-hidden="true">
        <div class="cc-caregiver-pulse ${isOutside ? 'cc-caregiver-pulse--outside' : 'cc-caregiver-pulse--inside'}"></div>
        <div class="cc-caregiver-pin cc-live-pin-bounce ${isOutside ? 'cc-caregiver-pin--outside' : 'cc-caregiver-pin--inside'}"></div>
      </div>
    `,
    iconSize: [34, 46],
    iconAnchor: [17, 40],
  });

export function MapContainer({
  center,
  zoom = 15,
  marker,
  geofence,
  patientLocation,
  patientStatus = 'INSIDE',
  patientMarkers,
  onMapClick,
  className = 'h-[280px] w-full max-w-full sm:h-[360px] lg:h-[400px]',
  enableHoverLift = false,
}: MapContainerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onMapClickRef = useRef<MapContainerProps['onMapClick']>(onMapClick);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const patientMarkerRef = useRef<L.Marker | null>(null);
  const multiPatientMarkersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapRef.current = L.map(containerRef.current);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapRef.current);

    mapRef.current.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current?.(e.latlng.lat, e.latlng.lng);
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    if (patientMarkers && patientMarkers.length > 1) {
      const bounds = L.latLngBounds(patientMarkers.map((item) => [item.lat, item.lng] as [number, number]));
      mapRef.current.fitBounds(bounds.pad(0.2), { maxZoom: 15 });
      return;
    }

    mapRef.current.setView(center, zoom);
  }, [center, zoom, patientMarkers]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (markerRef.current) {
      markerRef.current.remove();
    }

    if (marker) {
      markerRef.current = L.marker(marker, { icon: getHomeMarkerIcon() }).addTo(mapRef.current);
      markerRef.current.bindPopup('Home Location');
    }
  }, [marker]);

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

  useEffect(() => {
    if (!mapRef.current) return;

    if (patientMarkerRef.current) {
      patientMarkerRef.current.remove();
    }

    if (patientLocation) {
      const isOutside = patientStatus === 'OUTSIDE';
      patientMarkerRef.current = L.marker([patientLocation.lat, patientLocation.lng], {
        icon: getLivePatientIcon(isOutside),
      }).addTo(mapRef.current);
      patientMarkerRef.current.bindPopup(isOutside ? 'Patient Location (Outside Safe Zone)' : 'Patient Location');
    }
  }, [patientLocation, patientStatus]);

  useEffect(() => {
    if (!mapRef.current) return;

    multiPatientMarkersRef.current.forEach((markerItem) => markerItem.remove());
    multiPatientMarkersRef.current = [];

    if (!patientMarkers?.length) return;

    const createdMarkers = patientMarkers.map((item) => {
      const status = item.status ?? 'INSIDE';
      const markerItem = L.marker([item.lat, item.lng], {
        icon: getCaregiverPatientIcon(status === 'OUTSIDE'),
      }).addTo(mapRef.current!);

      markerItem.bindTooltip(item.name, {
        direction: 'top',
        offset: [0, -24],
        opacity: 0.95,
      });
      markerItem.bindPopup(
        status === 'OUTSIDE' ? `${item.name} (Outside Safe Zone)` : `${item.name} (Inside Safe Zone)`
      );

      return markerItem;
    });

    multiPatientMarkersRef.current = createdMarkers;
  }, [patientMarkers]);

  return (
    <div
      className={cn(
        'cc-map-shell relative w-full max-w-full overflow-hidden rounded-3xl border border-primary/15 bg-white/80 shadow-[0_16px_38px_-24px_rgba(15,23,42,0.7)]',
        enableHoverLift && 'cc-map-hover-lift',
        className
      )}
    >
      <div ref={containerRef} className="cc-map-canvas h-full w-full" />
    </div>
  );
}
