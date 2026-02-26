import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertTriangle,
  Brain,
  CheckCircle,
  MapPin,
  LogOut,
  Pill,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PatientSafetyGuidance } from '@/components/patient/PatientSafetyGuidance';
import { PatientActionCard } from '@/components/patient/PatientActionCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MapContainer } from '@/components/map/MapContainer';
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
type TimeOfDay = 'morning' | 'afternoon' | 'evening';
type AlertScenario = 'medicine_and_zone' | 'medicine_only' | 'outside_zone';
const QUERY_TIMEOUT_MS = 7000;

type QueryResult = {
  error: { message?: string } | null;
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const withQueryTimeout = async <T extends QueryResult>(
  query: PromiseLike<T>,
  timeoutMs = QUERY_TIMEOUT_MS
): Promise<T | null> => {
  const timeoutMarker = Symbol('query-timeout');
  let timeoutId: number | undefined;

  try {
    const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
      timeoutId = window.setTimeout(() => resolve(timeoutMarker), timeoutMs);
    });

    const result = await Promise.race([query, timeoutPromise]);
    if (result === timeoutMarker) {
      return null;
    }

    return result as T;
  } catch {
    return null;
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
};

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

    let isActive = true;
    let attempts = 0;
    const maxAttempts = 4;
    const delayMs = 500;

    const ensurePatientRow = async () => {
      const displayName =
        (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
        user.email?.split('@')[0] ||
        'Patient';

      return withQueryTimeout(
        supabase
          .from('patients')
          .upsert(
            {
              user_id: user.id,
              name: displayName,
              email: user.email ?? '',
            },
            { onConflict: 'user_id' }
          )
          .select('id')
          .maybeSingle()
      );
    };

    const fetchData = async (): Promise<void> => {
      try {
        const patientResult = await withQueryTimeout(
          supabase
            .from('patients')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle()
        );

        if (!isActive) return;

        let patientData = patientResult?.data ?? null;
        if (!patientData) {
          const created = await ensurePatientRow();
          if (!isActive) return;
          patientData = created?.data ?? null;
        }

        if (!patientData) {
          if (attempts < maxAttempts) {
            attempts++;
            await wait(delayMs * attempts);
            return fetchData();
          }

          toast({
            variant: 'destructive',
            title: 'Unable to load patient profile',
            description: patientResult?.error?.message ?? 'Please refresh and try again.',
          });
          return;
        }

        setPatientId(patientData.id);

        const geofenceResult = await withQueryTimeout(
          supabase
            .from('geofences')
            .select('home_lat, home_lng, radius')
            .eq('patient_id', patientData.id)
            .single()
        );
        if (!isActive) return;

        if (geofenceResult?.data) setGeofence(geofenceResult.data);

        const locationResult = await withQueryTimeout(
          supabase
            .from('location_logs')
            .select('lat, lng, created_at')
            .eq('patient_id', patientData.id)
            .order('created_at', { ascending: false })
            .limit(1)
        );
        if (!isActive) return;

        if (locationResult?.data?.[0]) setCurrentLocation(locationResult.data[0]);

        const scheduleResult = await withQueryTimeout(
          supabase
            .from('medication_schedule')
            .select('time_of_day, enabled')
            .eq('patient_id', patientData.id)
        );
        if (!isActive) return;

        const scheduleData = scheduleResult?.data;
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
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void fetchData();
    return () => {
      isActive = false;
    };
  }, [toast, user]);

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
      ? "You are doing well. One more step to complete today's routine."
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
      <div className="dashboard-fade-in mx-auto w-full max-w-6xl space-y-5 px-3 py-5 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8">
        <Card className="soft-appear overflow-hidden border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(195_95%_90%/.6),transparent_55%),radial-gradient(circle_at_bottom_right,hsl(148_70%_88%/.5),transparent_60%)] shadow-lg">
          <CardContent className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">My Dashboard</h1>
                <p className="max-w-xl text-base text-slate-700">
                  Calm daily support for safety, medicine checks, and brain wellness.
                </p>
              </div>

              <div className="flex w-full flex-wrap items-center gap-2 sm:gap-3 md:w-auto md:justify-end">
                {isSafe !== null && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="secondary"
                        className={`h-10 gap-2 whitespace-normal rounded-full px-3 text-xs sm:px-4 sm:text-sm ${
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
                      className="h-11 w-full rounded-xl border-primary/30 bg-white/80 px-4 text-base transition-all duration-200 hover:-translate-y-0.5 sm:w-auto"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign out
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Sign out securely</TooltipContent>
                </Tooltip>
              </div>
            </div>

            <p className="rounded-2xl border border-white/70 bg-white/80 p-4 text-sm text-slate-700 shadow-sm">
              {dailyGoalCount} / 3 daily goals completed. {motivationText}
            </p>
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
                className="soft-ripple h-11 w-full rounded-xl px-5 text-base sm:w-auto"
              >
                {requestingLocation ? 'Requesting...' : 'Enable Location'}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="soft-appear overflow-hidden border-primary/20 bg-[radial-gradient(circle_at_15%_25%,hsl(199_100%_94%),transparent_50%),radial-gradient(circle_at_95%_90%,hsl(264_80%_94%),transparent_45%),linear-gradient(150deg,hsl(0_0%_100%),hsl(191_100%_98%))] shadow-lg">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl text-slate-900 sm:text-3xl">Live Location</CardTitle>
            <CardDescription className="text-sm sm:text-base">
              Your live position and safe zone are shown in real time.
            </CardDescription>
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
              className="h-[270px] w-full max-w-full sm:h-[320px] lg:h-[360px]"
              enableHoverLift
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

        <div className="grid gap-4 md:grid-cols-2">
          <PatientActionCard
            to="/patient/status"
            title="Take Medication"
            description="Quickly verify your medicine photo and stay on your healthy routine."
            icon={Pill}
            variant="medication"
            className="soft-appear"
          />
          <PatientActionCard
            to="/patient/game"
            title="Brain Games"
            description="Enjoy a gentle memory activity to keep your mind active and sharp."
            icon={Brain}
            variant="games"
            className="soft-appear"
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
