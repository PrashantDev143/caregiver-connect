import { useEffect, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PatientSafetyGuidance } from '@/components/patient/PatientSafetyGuidance';
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

export default function PatientDashboard() {
  const { user } = useAuth();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [geoState, setGeoState] = useState<GeoPermissionState>('loading');
  const [lastAlertStatus, setLastAlertStatus] = useState<boolean | null>(null);
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
    </DashboardLayout>
  );
}
