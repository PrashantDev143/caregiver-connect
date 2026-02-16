import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertTriangle,
  CheckCircle,
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
import { isWithinGeofence } from '@/utils/distance';

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
  const { toast } = useToast();

  const [patientId, setPatientId] = useState<string | null>(null);
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [geoState, setGeoState] = useState<GeoPermissionState>('loading');
  const [zoneStatus, setZoneStatus] = useState<'INSIDE' | 'OUTSIDE'>('INSIDE');
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  const [requestingLocation, setRequestingLocation] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const permissionStatusRef = useRef<PermissionStatus | null>(null);
  const zoneStatusRef = useRef<'INSIDE' | 'OUTSIDE' | null>(null);
  const outsideWarningIntervalRef = useRef<number | null>(null);
  const hasAutoRequestedPermissionRef = useRef(false);

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

      if (locationData?.[0]) setCurrentLocation(locationData[0]);
      setLoading(false);
    };

    void fetchData();
  }, [user]);

  useEffect(() => {
    if (!patientId) return;

    const geofenceChannel = supabase
      .channel(`patient-${patientId}-geofences`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'geofences', filter: `patient_id=eq.${patientId}` },
        (payload) => {
          const next = payload.new as Geofence | null;
          if (next?.home_lat != null && next?.home_lng != null && next?.radius != null) {
            setGeofence(next);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(geofenceChannel);
    };
  }, [patientId]);

  const insertLocation = useCallback(async (lat: number, lng: number) => {
    const created_at_fallback = new Date().toISOString();

    if (!patientId) {
      setCurrentLocation({ lat, lng, created_at: created_at_fallback });
      return;
    }

    const { data, error } = await supabase
      .from('location_logs')
      .insert({ patient_id: patientId, lat, lng })
      .select('created_at')
      .single();

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Location update failed',
        description: error.message,
      });
      return;
    }

    setCurrentLocation({
      lat,
      lng,
      created_at: (data?.created_at as string) ?? created_at_fallback,
    });
  }, [patientId, toast]);

  const stopLocationTracking = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startLocationTracking = useCallback(() => {
    if (!navigator.geolocation || watchIdRef.current != null) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoState('granted');
        void insertLocation(pos.coords.latitude, pos.coords.longitude);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGeoState('denied');
          setShowLocationPrompt(true);
        } else if (error.code === error.TIMEOUT) {
          setGeoState('timeout');
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5000 }
    );
  }, [insertLocation]);

  const requestLocationAccess = useCallback(async () => {
    if (!navigator.geolocation) {
      setGeoState('unavailable');
      return;
    }

    setRequestingLocation(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoState('granted');
        setShowLocationPrompt(false);
        void insertLocation(pos.coords.latitude, pos.coords.longitude);
        startLocationTracking();
        setRequestingLocation(false);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGeoState('denied');
          setShowLocationPrompt(true);
          toast({
            variant: 'destructive',
            title: 'Location permission denied',
            description: 'Enable location permission in browser settings to continue safety tracking.',
          });
        } else if (error.code === error.TIMEOUT) {
          setGeoState('timeout');
          toast({
            variant: 'destructive',
            title: 'Location timeout',
            description: 'Unable to fetch your current location. Please try again.',
          });
        }
        setRequestingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  }, [insertLocation, startLocationTracking, toast]);

  useEffect(() => {
    if (!patientId) return;
    if (!navigator.geolocation) {
      setGeoState('unavailable');
      setShowLocationPrompt(false);
      return;
    }

    const detectPermission = async () => {
      if (!('permissions' in navigator)) {
        setShowLocationPrompt(true);
        return;
      }

      try {
        const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        permissionStatusRef.current = status;

        if (status.state === 'granted') {
          setGeoState('granted');
          setShowLocationPrompt(false);
          await requestLocationAccess();
        } else if (status.state === 'prompt') {
          setGeoState('loading');
          setShowLocationPrompt(true);
          if (!hasAutoRequestedPermissionRef.current) {
            hasAutoRequestedPermissionRef.current = true;
            await requestLocationAccess();
          }
        } else {
          setGeoState('denied');
          setShowLocationPrompt(true);
        }

        status.onchange = () => {
          if (status.state === 'granted') {
            setGeoState('granted');
            setShowLocationPrompt(false);
            void requestLocationAccess();
          } else if (status.state === 'denied') {
            setGeoState('denied');
            setShowLocationPrompt(true);
            stopLocationTracking();
          } else {
            setShowLocationPrompt(true);
          }
        };
      } catch {
        setShowLocationPrompt(true);
      }
    };

    void detectPermission();
  }, [patientId, requestLocationAccess, stopLocationTracking]);

  useEffect(() => {
    return () => {
      stopLocationTracking();
      if (permissionStatusRef.current) {
        permissionStatusRef.current.onchange = null;
      }
    };
  }, [stopLocationTracking]);

  useEffect(() => {
    if (!currentLocation || !geofence || !patientId) return;

    const inside = isWithinGeofence(
      currentLocation.lat,
      currentLocation.lng,
      geofence.home_lat,
      geofence.home_lng,
      geofence.radius
    );

    const nextStatus: 'INSIDE' | 'OUTSIDE' = inside ? 'INSIDE' : 'OUTSIDE';
    setZoneStatus(nextStatus);

    const syncAlertStatus = async () => {
      if (nextStatus === zoneStatusRef.current) return;

      if (inside) {
        const { error } = await supabase
          .from('alerts')
          .update({ status: 'resolved', resolved_at: new Date().toISOString() })
          .eq('patient_id', patientId)
          .eq('status', 'active');

        if (error) {
          console.error('[PatientDashboard] resolve alerts failed:', error.message);
        }
      } else {
        const { data: existingAlert, error: checkError } = await supabase
          .from('alerts')
          .select('id')
          .eq('patient_id', patientId)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();

        if (checkError) {
          console.error('[PatientDashboard] check active alert failed:', checkError.message);
          return;
        }

        if (!existingAlert) {
          const { error: insertError } = await supabase.from('alerts').insert({
            patient_id: patientId,
            status: 'active',
            message: 'Patient left the safe zone',
          });

          if (insertError) {
            console.error('[PatientDashboard] create alert failed:', insertError.message);
          }
        }
      }

      zoneStatusRef.current = nextStatus;
    };

    void syncAlertStatus();
  }, [currentLocation, geofence, patientId]);

  useEffect(() => {
    if (zoneStatus !== 'OUTSIDE') {
      if (outsideWarningIntervalRef.current !== null) {
        window.clearInterval(outsideWarningIntervalRef.current);
        outsideWarningIntervalRef.current = null;
      }
      return;
    }

    const sendWarning = () => {
      toast({
        variant: 'destructive',
        title: 'Warning: You are outside your safe zone',
        description: 'Please return to your safe zone immediately.',
      });

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('SafeZone Warning', {
          body: 'You are outside your safe zone. Please return now.',
        });
      }
    };

    sendWarning();
    outsideWarningIntervalRef.current = window.setInterval(sendWarning, 30_000);

    return () => {
      if (outsideWarningIntervalRef.current !== null) {
        window.clearInterval(outsideWarningIntervalRef.current);
        outsideWarningIntervalRef.current = null;
      }
    };
  }, [zoneStatus, toast]);

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

  const displayLocation = currentLocation ? { lat: currentLocation.lat, lng: currentLocation.lng } : null;
  const isSafe = displayLocation && geofence ? zoneStatus === 'INSIDE' : null;
  const fallbackCenter: [number, number] = geofence
    ? [geofence.home_lat, geofence.home_lng]
    : displayLocation
      ? [displayLocation.lat, displayLocation.lng]
      : [20.5937, 78.9629];

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

        {showLocationPrompt && (
          <Card className={geoState === 'denied' ? 'border-destructive' : ''}>
            <CardHeader>
              <CardTitle>Enable Live Location</CardTitle>
              <CardDescription>
                Location is required for safe-zone monitoring and caregiver alerts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {geoState === 'denied'
                  ? 'Location permission is currently blocked. Enable it in your browser settings, then retry.'
                  : 'Please allow location access to start continuous safety tracking.'}
              </p>
              <Button onClick={() => void requestLocationAccess()} disabled={requestingLocation}>
                {requestingLocation ? 'Requesting...' : 'Enable Location'}
              </Button>
            </CardContent>
          </Card>
        )}

        <PatientMedicineVerification patientId={patientId!} />

        <Card>
          <CardHeader>
            <CardTitle>Location Map</CardTitle>
            <CardDescription>Your current position and safe zone</CardDescription>
          </CardHeader>
          <CardContent>
            <MapContainer
              center={displayLocation ? [displayLocation.lat, displayLocation.lng] : fallbackCenter}
              zoom={15}
              geofence={
                geofence
                  ? { lat: geofence.home_lat, lng: geofence.home_lng, radius: geofence.radius }
                  : undefined
              }
              patientLocation={displayLocation ?? undefined}
              patientStatus={zoneStatus}
              className="h-[350px] w-full rounded-lg"
            />
            {!displayLocation && (
              <p className="mt-3 text-sm text-muted-foreground">
                Waiting for live location. Enable location permission to start tracking.
              </p>
            )}
            {!geofence && (
              <p className="mt-2 text-sm text-muted-foreground">
                Safe zone is not configured yet. Ask your caregiver to set geofence.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Location Simulation</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button variant="outline" onClick={() => void simulateLocation('home')} disabled={isSimulating}>
              Home
            </Button>
            <Button variant="outline" onClick={() => void simulateLocation('random')} disabled={isSimulating}>
              Inside
            </Button>
            <Button
              variant="outline"
              onClick={() => void simulateLocation('outside')}
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
