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
  const { user } = useAuth();
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
      const { data: patientData, error: patientError } = await supabase
        .from('patients')
        .select('id')
        .eq('user_id', user.id)
        .single();

      console.log('[PatientDashboard] patients fetch:', { data: patientData, error: patientError?.message ?? null });

      if (patientError) {
        console.error('[PatientDashboard] patients fetch failed:', patientError);
      }

      if (!patientData) {
        if (attempts < maxAttempts) {
          attempts++;
          await new Promise((r) => setTimeout(r, delayMs));
          return fetchData();
        }
        console.warn('[PatientDashboard] patient row not found after retries, user_id=', user.id);
        setLoading(false);
        return;
      }

      setPatientId(patientData.id);
      console.log('[PatientDashboard] patient_id resolved:', patientData.id);

      const { data: geofenceData, error: geofenceError } = await supabase
        .from('geofences')
        .select('home_lat, home_lng, radius')
        .eq('patient_id', patientData.id)
        .single();

      console.log('[PatientDashboard] geofence fetch:', { data: geofenceData != null, error: geofenceError?.message ?? null });
      if (geofenceError) console.log('[PatientDashboard] geofence:', geofenceError.message);
      if (geofenceData) setGeofence(geofenceData);

      const { data: locationData, error: locationError } = await supabase
        .from('location_logs')
        .select('lat, lng, created_at')
        .eq('patient_id', patientData.id)
        .order('created_at', { ascending: false })
        .limit(1);

      console.log('[PatientDashboard] location_logs fetch:', { rows: locationData?.length ?? 0, error: locationError?.message ?? null });
      if (locationError) console.error('[PatientDashboard] location_logs fetch failed:', locationError);
      if (locationData?.[0]) {
        setCurrentLocation(locationData[0]);
        if (geofenceData) {
          const inside = isWithinGeofence(
            locationData[0].lat,
            locationData[0].lng,
            geofenceData.home_lat,
            geofenceData.home_lng,
            geofenceData.radius
          );
          setLastAlertStatus(inside);
        }
      }

      setLoading(false);
    };

    fetchData();
  }, [user]);

  const insertLocation = async (lat: number, lng: number) => {
    if (!patientId) {
      console.warn('[PatientDashboard] insertLocation skipped: patient_id is null');
      return;
    }

    const { data, error } = await supabase
      .from('location_logs')
      .insert({ patient_id: patientId, lat, lng })
      .select('id, created_at')
      .single();

    if (error) {
      console.error('[PatientDashboard] location_logs insert failed:', error);
      return;
    }
    console.log('[PatientDashboard] location_logs insert success:', { id: data?.id, created_at: data?.created_at });
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
      const metersToLat = distance / 111_320;
      const metersToLng = distance / (111_320 * Math.cos((home_lat * Math.PI) / 180));
      lat = home_lat + metersToLat * Math.cos(angle);
      lng = home_lng + metersToLng * Math.sin(angle);
    }

    try {
      await insertLocation(lat, lng);
    } finally {
      setIsSimulating(false);
    }
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
      supabase
        .from('alerts')
        .insert({ patient_id: patientId, status: 'active', message: 'Patient left the safe zone' });
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
      (err) => {
        if (err.code === 1) setGeoState('denied');
        else if (err.code === 2) setGeoState('unavailable');
        else if (err.code === 3) setGeoState('timeout');
        else setGeoState('unavailable');
        console.warn('[PatientDashboard] geolocation error:', err.code, err.message);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5000 }
    );

    watchIdRef.current = watchId;
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
  }, []);

  const displayLocation = liveLocation ?? (currentLocation ? { lat: currentLocation.lat, lng: currentLocation.lng } : null);
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
  const distanceFromHome =
    displayLocation && geofence
      ? Math.round(
          calculateDistance(
            displayLocation.lat,
            displayLocation.lng,
            geofence.home_lat,
            geofence.home_lng
          )
        )
      : null;
  const mapCenter = displayLocation
    ? ([displayLocation.lat, displayLocation.lng] as [number, number])
    : geofence
    ? ([geofence.home_lat, geofence.home_lng] as [number, number])
    : null;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center text-center text-4xl font-semibold">
          LOADING
        </div>
      </DashboardLayout>
    );
  }

  if (!patientId) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center text-center text-4xl font-semibold">
          SETTING UP ACCOUNT
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PatientSafetyGuidance geofence={geofence} location={displayLocation} geoState={geoState} />

      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Dashboard</h1>
            <p className="text-muted-foreground">Monitor your safety status</p>
          </div>
          <div className="flex items-center gap-3">
            {geoState === 'granted' && (
              <Badge variant="secondary" className="gap-1 bg-green-100 text-green-700">
                <Locate className="h-3 w-3" />
                Live location on
              </Badge>
            )}
            {(geoState === 'denied' || geoState === 'unavailable' || geoState === 'timeout') && (
              <Badge variant="outline" className="gap-1 text-amber-600">
                <LocateOff className="h-3 w-3" />
                Location off
              </Badge>
            )}
            {isSafe !== null &&
              (isSafe ? (
                <Badge variant="secondary" className="gap-2 bg-green-100 px-4 py-2 text-lg text-green-700">
                  <CheckCircle className="h-5 w-5" />
                  SAFE
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-2 px-4 py-2 text-lg">
                  <AlertTriangle className="h-5 w-5" />
                  WARNING
                </Badge>
              ))}
          </div>
        </div>

        {geoState === 'denied' && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <p className="text-sm text-amber-800">
                Location access was denied. Enable location in your browser to share your live position and use the map.
              </p>
            </CardContent>
          </Card>
        )}

        {geoState === 'unavailable' && (
          <Card className="border-muted">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Location is not available on this device.</p>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Distance from Home</CardTitle>
              <Home className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{distanceFromHome !== null ? `${distanceFromHome}m` : '--'}</div>
              <p className="text-xs text-muted-foreground">{geofence ? `Safe zone: ${geofence.radius}m radius` : 'No geofence set'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Last Update</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {currentLocation ? new Date(currentLocation.created_at).toLocaleTimeString() : '--'}
              </div>
              <p className="text-xs text-muted-foreground">
                {currentLocation ? new Date(currentLocation.created_at).toLocaleDateString() : 'No location data yet'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Caregiver Status</CardTitle>
              <Wifi className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{geofence ? 'Connected' : 'Pending'}</div>
              <p className="text-xs text-muted-foreground">{geofence ? 'Geofence configured' : 'Waiting for caregiver setup'}</p>
            </CardContent>
          </Card>
        </div>

        <PatientMedicineVerification patientId={patientId} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Location Map
            </CardTitle>
            <CardDescription>
              {displayLocation ? 'Your current position and safe zone' : 'Enable location or use simulation to see the map'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mapCenter ? (
              <MapContainer
                center={mapCenter}
                zoom={15}
                marker={geofence ? [geofence.home_lat, geofence.home_lng] : undefined}
                geofence={geofence ? { lat: geofence.home_lat, lng: geofence.home_lng, radius: geofence.radius } : undefined}
                patientLocation={displayLocation ?? undefined}
                className="h-[350px] w-full rounded-lg"
              />
            ) : (
              <div className="h-[350px] w-full rounded-lg" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Navigation className="h-5 w-5" />
              Location Simulation
            </CardTitle>
            <CardDescription>For demo: simulate different location scenarios</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => simulateLocation('home')} disabled={isSimulating || !geofence}>
                <Home className="mr-2 h-4 w-4" />
                At Home
              </Button>
              <Button variant="outline" onClick={() => simulateLocation('random')} disabled={isSimulating || !geofence}>
                <MapPin className="mr-2 h-4 w-4" />
                Random (Inside)
              </Button>
              <Button
                variant="outline"
                onClick={() => simulateLocation('outside')}
                disabled={isSimulating || !geofence}
                className="border-destructive text-destructive hover:bg-destructive/10"
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                Go Outside Zone
              </Button>
            </div>
            {!geofence && (
              <p className="mt-3 text-sm text-muted-foreground">Your caregiver needs to set up a geofence before you can simulate locations.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
