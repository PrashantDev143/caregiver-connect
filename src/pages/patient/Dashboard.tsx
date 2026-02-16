import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Home,
  Locate,
  LocateOff,
  MapPin,
  Navigation,
  Wifi,
  LogOut,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PatientSafetyGuidance } from '@/components/patient/PatientSafetyGuidance';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapContainer } from '@/components/map/MapContainer';
import { PatientMedicineVerification } from '@/components/medicine/PatientMedicineVerification';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { calculateDistance, isWithinGeofence } from '@/utils/distance';

interface Geofence {
  home_lat: number;
  home_lng: number;
  radius: number;
}

interface Location {
  lat: number;
  lng: number;
  created_at: string;
}

type GeoPermissionState = 'loading' | 'granted' | 'denied' | 'unavailable' | 'timeout';
type SimulationMode = 'home' | 'random' | 'outside';

export default function PatientDashboard() {
  const { user, signOut } = useAuth();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [geoState, setGeoState] = useState<GeoPermissionState>('loading');
  const [lastAlertStatus, setLastAlertStatus] = useState<boolean | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const lastAlertStatusRef = useRef<boolean | null>(null);
  const watchIdRef = useRef<number | null>(null);
  lastAlertStatusRef.current = lastAlertStatus;

  useEffect(() => {
    if (!user) return;

    let attempts = 0;
    const maxAttempts = 5;
    const delayMs = 600;

    const fetchData = async (): Promise<void> => {
      const { data: patientData } = await supabase
        .from('patients')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!patientData) {
        if (attempts < maxAttempts) {
          attempts++;
          await new Promise((r) => setTimeout(r, delayMs));
          return fetchData();
        }
        setLoading(false);
        return;
      }

      setPatientId(patientData.id);

      const { data: geofenceData } = await supabase
        .from('geofences')
        .select('home_lat, home_lng, radius')
        .eq('patient_id', patientData.id)
        .single();

      if (geofenceData) setGeofence(geofenceData);

      const { data: locationData } = await supabase
        .from('location_logs')
        .select('lat, lng, created_at')
        .eq('patient_id', patientData.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (locationData?.[0]) {
        setCurrentLocation(locationData[0]);
        if (geofenceData) {
          setLastAlertStatus(
            isWithinGeofence(
              locationData[0].lat,
              locationData[0].lng,
              geofenceData.home_lat,
              geofenceData.home_lng,
              geofenceData.radius
            )
          );
        }
      }

      setLoading(false);
    };

    fetchData();
  }, [user]);

  const insertLocation = async (lat: number, lng: number) => {
    if (!patientId) return;

    const { data } = await supabase
      .from('location_logs')
      .insert({ patient_id: patientId, lat, lng })
      .select('created_at')
      .single();

    const created_at = (data?.created_at as string) ?? new Date().toISOString();
    setCurrentLocation({ lat, lng, created_at });
    setLiveLocation({ lat, lng });
  };

  const simulateLocation = async (mode: SimulationMode) => {
    if (!geofence) return;
    setIsSimulating(true);

    const { home_lat, home_lng, radius } = geofence;
    let lat = home_lat;
    let lng = home_lng;

    if (mode !== 'home') {
      const angle = Math.random() * Math.PI * 2;
      const distance =
        mode === 'random'
          ? Math.random() * radius * 0.85
          : Math.max(radius * 1.2, radius + 25);
      lat += (distance / 111_320) * Math.cos(angle);
      lng += (distance / (111_320 * Math.cos((home_lat * Math.PI) / 180))) * Math.sin(angle);
    }

    await insertLocation(lat, lng);
    setIsSimulating(false);
  };

  useEffect(() => {
    if (!currentLocation || !geofence || !patientId) return;

    const inside = isWithinGeofence(
      currentLocation.lat,
      currentLocation.lng,
      geofence.home_lat,
      geofence.home_lng,
      geofence.radius
    );

    const prev = lastAlertStatusRef.current;
    if (prev === null) {
      setLastAlertStatus(inside);
      return;
    }

    if (!inside && prev) {
      supabase.from('alerts').insert({
        patient_id: patientId,
        status: 'active',
        message: 'Patient left the safe zone',
      });
      setLastAlertStatus(false);
    } else if (inside && !prev) {
      supabase
        .from('alerts')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .eq('patient_id', patientId)
        .eq('status', 'active');
      setLastAlertStatus(true);
    }
  }, [currentLocation?.lat, currentLocation?.lng, geofence, patientId]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoState('unavailable');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoState('granted');
        insertLocation(pos.coords.latitude, pos.coords.longitude);
      },
      () => setGeoState('denied'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5000 }
    );

    watchIdRef.current = watchId;
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  const displayLocation =
    liveLocation ?? (currentLocation ? { lat: currentLocation.lat, lng: currentLocation.lng } : null);

  const isSafe =
    displayLocation && geofence
      ? isWithinGeofence(
          displayLocation.lat,
          displayLocation.lng,
          geofence.home_lat,
          geofence.home_lng,
          geofence.radius
        )
      : null;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center text-4xl font-semibold">
          LOADING
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PatientSafetyGuidance geofence={geofence} location={displayLocation} geoState={geoState} />

      <div className="space-y-6">
        {/* HEADER */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Dashboard</h1>
            <p className="text-muted-foreground">Monitor your safety status</p>
          </div>

          <div className="flex items-center gap-3">
            {isSafe !== null &&
              (isSafe ? (
                <Badge variant="secondary" className="gap-2 bg-green-100 text-green-700">
                  <CheckCircle className="h-4 w-4" />
                  SAFE
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  WARNING
                </Badge>
              ))}

            <Button variant="outline" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>

        <PatientMedicineVerification patientId={patientId!} />

        {/* MAP */}
        <Card>
          <CardHeader>
            <CardTitle>Location Map</CardTitle>
            <CardDescription>Your current position and safe zone</CardDescription>
          </CardHeader>
          <CardContent>
            {displayLocation && geofence && (
              <MapContainer
                center={[displayLocation.lat, displayLocation.lng]}
                zoom={15}
                geofence={{ lat: geofence.home_lat, lng: geofence.home_lng, radius: geofence.radius }}
                patientLocation={displayLocation}
                className="h-[350px] w-full rounded-lg"
              />
            )}
          </CardContent>
        </Card>

        {/* SIMULATION */}
        <Card>
          <CardHeader>
            <CardTitle>Location Simulation</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button variant="outline" onClick={() => simulateLocation('home')} disabled={isSimulating}>
              Home
            </Button>
            <Button variant="outline" onClick={() => simulateLocation('random')} disabled={isSimulating}>
              Inside
            </Button>
            <Button
              variant="outline"
              onClick={() => simulateLocation('outside')}
              className="border-destructive text-destructive"
              disabled={isSimulating}
            >
              Outside
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
