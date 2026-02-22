import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle,
  Compass,
  MapPin,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PatientSafetyGuidance } from '@/components/patient/PatientSafetyGuidance';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MapContainer } from '@/components/map/MapContainer';
import { PatientMedicineVerification } from '@/components/medicine/PatientMedicineVerification';
import { BrainGamesSection } from '@/components/games/BrainGamesSection';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { isWithinGeofence } from '@/utils/distance';
import { useAlertVoice } from '@/hooks/useAlertVoice';

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
type TimeOfDay = 'morning' | 'afternoon' | 'evening';
type AlertScenario = 'medicine_and_zone' | 'medicine_only' | 'outside_zone';

const getCurrentTimeSlot = (now: Date): TimeOfDay => {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
};

export default function PatientDashboard() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { playAlert } = useAlertVoice();

  const [patientId, setPatientId] = useState<string | null>(null);
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [geoState, setGeoState] = useState<GeoPermissionState>('loading');
  const [zoneStatus, setZoneStatus] = useState<'INSIDE' | 'OUTSIDE'>('INSIDE');
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  const [requestingLocation, setRequestingLocation] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [medicationSchedule, setMedicationSchedule] = useState<Record<TimeOfDay, boolean>>({
    morning: false,
    afternoon: false,
    evening: false,
  });

  const watchIdRef = useRef<number | null>(null);
  const permissionStatusRef = useRef<PermissionStatus | null>(null);
  const zoneStatusRef = useRef<'INSIDE' | 'OUTSIDE' | null>(null);
  const alertTimerRef = useRef<number | null>(null);
  const lastScenarioPlayedRef = useRef<AlertScenario | null>(null);
  const lastScenarioPlayedAtRef = useRef<Record<AlertScenario, number>>({
    medicine_and_zone: 0,
    medicine_only: 0,
    outside_zone: 0,
  });
  const hasAutoRequestedPermissionRef = useRef(false);
  const [currentTimeSlot, setCurrentTimeSlot] = useState<TimeOfDay>(() =>
    getCurrentTimeSlot(new Date())
  );

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

      const { data: scheduleData } = await supabase
        .from('medication_schedule')
        .select('time_of_day, enabled')
        .eq('patient_id', patientData.id);

      if (scheduleData) {
        const next: Record<TimeOfDay, boolean> = {
          morning: false,
          afternoon: false,
          evening: false,
        };
        scheduleData.forEach((entry) => {
          const slot = entry.time_of_day as TimeOfDay;
          if (slot in next) next[slot] = Boolean(entry.enabled);
        });
        setMedicationSchedule(next);
      }

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

    const scheduleChannel = supabase
      .channel(`patient-${patientId}-medication-schedule`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'medication_schedule', filter: `patient_id=eq.${patientId}` },
        () => {
          supabase
            .from('medication_schedule')
            .select('time_of_day, enabled')
            .eq('patient_id', patientId)
            .then(({ data }) => {
              if (!data) return;
              const next: Record<TimeOfDay, boolean> = {
                morning: false,
                afternoon: false,
                evening: false,
              };
              data.forEach((entry) => {
                const slot = entry.time_of_day as TimeOfDay;
                if (slot in next) next[slot] = Boolean(entry.enabled);
              });
              setMedicationSchedule(next);
            });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(geofenceChannel);
      supabase.removeChannel(scheduleChannel);
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
    const timer = window.setInterval(() => {
      setCurrentTimeSlot(getCurrentTimeSlot(new Date()));
    }, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  const isMedicineTime = medicationSchedule[currentTimeSlot];
  const activeAlertScenario = useMemo<AlertScenario | null>(() => {
    if (!currentLocation || !geofence) {
      return null;
    }

    if (isMedicineTime && zoneStatus === 'OUTSIDE') {
      return 'medicine_and_zone';
    }
    if (isMedicineTime && zoneStatus === 'INSIDE') {
      return 'medicine_only';
    }
    if (!isMedicineTime && zoneStatus === 'OUTSIDE') {
      return 'outside_zone';
    }
    return null;
  }, [currentLocation, geofence, isMedicineTime, zoneStatus]);

  useEffect(() => {
    if (alertTimerRef.current !== null) {
      window.clearInterval(alertTimerRef.current);
      alertTimerRef.current = null;
    }

    if (!activeAlertScenario) {
      lastScenarioPlayedRef.current = null;
      return;
    }

    const scenarioConfig = {
      medicine_and_zone: {
        title: 'Medicine and safe zone reminder',
        message: 'You need to take your medicine and return to your safe zone.',
      },
      medicine_only: {
        title: 'Medicine reminder',
        message: "It's time to take your medicine.",
      },
      outside_zone: {
        title: 'Safe zone reminder',
        message: 'You are outside your safe area.',
      },
    } as const;

    const notifyScenario = () => {
      const now = Date.now();
      const cooldownMs = 90_000;
      const lastPlayed = lastScenarioPlayedAtRef.current[activeAlertScenario];
      const hasScenarioChanged = lastScenarioPlayedRef.current !== activeAlertScenario;
      if (!hasScenarioChanged && now - lastPlayed < cooldownMs) {
        return;
      }

      const config = scenarioConfig[activeAlertScenario];
      toast({
        variant: activeAlertScenario === 'outside_zone' ? 'destructive' : 'default',
        title: config.title,
        description: config.message,
      });

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(config.title, { body: config.message });
      }

      void playAlert(activeAlertScenario, { cooldownMs: 20_000 });
      lastScenarioPlayedRef.current = activeAlertScenario;
      lastScenarioPlayedAtRef.current[activeAlertScenario] = now;
    };

    notifyScenario();
    alertTimerRef.current = window.setInterval(notifyScenario, 30_000);

    return () => {
      if (alertTimerRef.current !== null) {
        window.clearInterval(alertTimerRef.current);
        alertTimerRef.current = null;
      }
    };
  }, [activeAlertScenario, playAlert, toast]);

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
  const enabledSlots = (['morning', 'afternoon', 'evening'] as TimeOfDay[]).filter((slot) => medicationSchedule[slot]);
  const dailyGoalCount = [
    geoState === 'granted',
    Boolean(geofence),
    enabledSlots.length > 0,
  ].filter(Boolean).length;
  const dailyGoalProgress = (dailyGoalCount / 3) * 100;
  const motivationText =
    dailyGoalCount === 3
      ? 'Excellent rhythm today. Keep up the great routine.'
      : dailyGoalCount === 2
      ? 'You are doing well. One more step to complete today’s routine.'
      : 'Small steps matter. Start with one task and keep going.';
  const fallbackCenter: [number, number] = geofence
    ? [geofence.home_lat, geofence.home_lng]
    : displayLocation
      ? [displayLocation.lat, displayLocation.lng]
      : [20.5937, 78.9629];

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
          <Card className="w-full max-w-md border-primary/20 shadow-lg">
            <CardContent className="flex flex-col items-center gap-4 py-10">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p className="text-xl font-semibold">Loading your dashboard</p>
              <p className="text-center text-sm text-muted-foreground">
                Getting your latest safety and medication updates.
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Card className="soft-appear overflow-hidden border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(195_95%_90%/.6),transparent_55%),radial-gradient(circle_at_bottom_right,hsl(148_70%_88%/.5),transparent_60%)] shadow-lg">
          <CardContent className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">My Dashboard</h1>
                <p className="max-w-xl text-base text-slate-700">
                  Calm daily support for safety, medicine checks, and brain wellness.
                </p>
              </div>

              <div className="flex items-center gap-3">
                {isSafe !== null && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="secondary"
                        className={`h-10 gap-2 rounded-full px-4 text-sm ${
                          isSafe ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {isSafe ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                        {isSafe ? 'Safe Zone: Inside' : 'Safe Zone: Outside'}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>{isSafe ? 'You are currently inside your safe zone.' : 'Please return to your safe zone.'}</TooltipContent>
                  </Tooltip>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={signOut}
                      className="h-11 rounded-xl border-primary/30 bg-white/80 px-4 text-base transition-all duration-200 hover:-translate-y-0.5"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign out
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Sign out securely</TooltipContent>
                </Tooltip>
              </div>
            </div>

            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Daily wellness progress</p>
                <p className="text-sm font-semibold text-primary">{dailyGoalCount} / 3 completed</p>
              </div>
              <Progress value={dailyGoalProgress} className="h-2 bg-primary/10" />
              <p className="mt-2 text-sm text-slate-700">{motivationText}</p>
            </div>
          </CardContent>
        </Card>

        <PatientSafetyGuidance geofence={geofence} location={displayLocation} geoState={geoState} />

        {showLocationPrompt && (
          <Card className={`soft-appear border-primary/20 shadow-sm ${geoState === 'denied' ? 'border-rose-300 bg-rose-50/60' : 'bg-cyan-50/50'}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <MapPin className="h-5 w-5 text-primary" />
                Enable Live Location
              </CardTitle>
              <CardDescription>
                Location is required for safe-zone monitoring and caregiver alerts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-base text-slate-700">
                {geoState === 'denied'
                  ? 'Location permission is currently blocked. Enable it in your browser settings, then retry.'
                  : 'Please allow location access to start continuous safety tracking.'}
              </p>
              <Button
                onClick={() => void requestLocationAccess()}
                disabled={requestingLocation}
                className="h-11 rounded-xl px-5 text-base"
              >
                {requestingLocation ? 'Requesting...' : 'Enable Location'}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="soft-appear border-primary/20 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Safety Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-slate-900">
                {isSafe === null ? 'Pending' : isSafe ? 'Protected' : 'Needs Attention'}
              </p>
              <p className="text-sm text-muted-foreground">Live zone checks and caregiver alerts are active.</p>
            </CardContent>
          </Card>

          <Card className="soft-appear border-primary/20 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="h-4 w-4 text-cyan-600" />
                Medication Slots
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-slate-900">{enabledSlots.length}</p>
              <p className="text-sm text-muted-foreground">Scheduled for today by your caregiver.</p>
            </CardContent>
          </Card>

          <Card className="soft-appear border-primary/20 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Compass className="h-4 w-4 text-emerald-600" />
                Location Sharing
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-slate-900">{geoState === 'granted' ? 'On' : 'Off'}</p>
              <p className="text-sm text-muted-foreground">Continuous tracking keeps your care team informed.</p>
            </CardContent>
          </Card>
        </div>

        <PatientMedicineVerification patientId={patientId!} />

        <BrainGamesSection className="soft-appear" />

        <Card className="soft-appear border-primary/20 shadow-sm">
          <CardHeader>
            <CardTitle>Today&apos;s Medication Schedule</CardTitle>
            <CardDescription>Configured by your caregiver</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(['morning', 'afternoon', 'evening'] as TimeOfDay[]).map((slot) =>
                medicationSchedule[slot] ? (
                  <Badge key={slot} variant="outline" className="rounded-full px-3 py-1 text-sm capitalize">
                    {slot}
                  </Badge>
                ) : null
              )}
              {!medicationSchedule.morning &&
                !medicationSchedule.afternoon &&
                !medicationSchedule.evening && (
                  <p className="text-sm text-muted-foreground">No schedule set yet.</p>
                )}
            </div>
            <p className="text-sm text-emerald-800">You are building a strong daily routine. Keep going.</p>
          </CardContent>
        </Card>

        <Card className="soft-appear border-primary/20 shadow-sm">
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
              className="h-[340px] w-full rounded-2xl border border-primary/20"
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

        <Card className="soft-appear border-primary/20 shadow-sm">
          <CardHeader>
            <CardTitle>Location Simulation</CardTitle>
            <CardDescription>Quick test controls for inside and outside zone states.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => void simulateLocation('home')}
              disabled={isSimulating}
              className="h-11 rounded-xl px-5"
            >
              Home
            </Button>
            <Button
              variant="outline"
              onClick={() => void simulateLocation('random')}
              disabled={isSimulating}
              className="h-11 rounded-xl px-5"
            >
              Inside
            </Button>
            <Button
              variant="outline"
              onClick={() => void simulateLocation('outside')}
              className="h-11 rounded-xl border-destructive text-destructive"
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
