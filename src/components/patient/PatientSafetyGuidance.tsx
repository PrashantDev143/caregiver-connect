import { useMemo } from 'react';
import { isWithinGeofence } from '@/utils/distance';

interface Geofence {
  home_lat: number;
  home_lng: number;
  radius: number;
}

interface Location {
  lat: number;
  lng: number;
}

type GeoPermissionState = 'loading' | 'granted' | 'denied' | 'unavailable' | 'timeout';

interface PatientSafetyGuidanceProps {
  geofence: Geofence | null;
  location: Location | null;
  geoState: GeoPermissionState;
}

const toRad = (value: number) => (value * Math.PI) / 180;
const toDeg = (value: number) => (value * 180) / Math.PI;

const calculateBearing = (from: Location, to: Location) => {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const deltaLng = toRad(to.lng - from.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

export function PatientSafetyGuidance({ geofence, location, geoState }: PatientSafetyGuidanceProps) {
  const guidance = useMemo(() => {
    if (geoState === 'denied' || geoState === 'unavailable') {
      return { message: 'TURN ON LOCATION', status: 'attention' as const };
    }

    if (!geofence || !location) {
      return { message: 'WAITING FOR LOCATION', status: 'neutral' as const };
    }

    const inside = isWithinGeofence(
      location.lat,
      location.lng,
      geofence.home_lat,
      geofence.home_lng,
      geofence.radius
    );

    if (inside) {
      return { message: 'YOU ARE SAFE', status: 'safe' as const };
    }

    const bearing = calculateBearing(location, { lat: geofence.home_lat, lng: geofence.home_lng });
    return { message: 'RETURN HOME', status: 'danger' as const, bearing };
  }, [geoState, geofence, location]);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-10 px-10 text-center">
      <div
        className={
          guidance.status === 'danger'
            ? 'text-5xl font-semibold text-red-600'
            : guidance.status === 'safe'
              ? 'text-5xl font-semibold text-green-600'
              : 'text-4xl font-semibold text-foreground'
        }
      >
        {guidance.message}
      </div>
      {guidance.status === 'danger' && typeof guidance.bearing === 'number' && (
        <div className="flex items-center justify-center">
          <div
            className="h-32 w-32 animate-[pulse_3s_ease-in-out_infinite] text-red-600"
            style={{ transform: `rotate(${guidance.bearing}deg)` }}
          >
            <svg viewBox="0 0 120 120" className="h-full w-full fill-current">
              <path d="M60 10l35 60h-24v40H49V70H25z" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
