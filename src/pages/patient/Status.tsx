import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { calculateDistance, isWithinGeofence } from '@/utils/distance';
import {
  MapPin,
  AlertTriangle,
  CheckCircle,
  Clock,
  Home,
  Target,
  History,
} from 'lucide-react';

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

interface Alert {
  id: string;
  status: string;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
}

export default function PatientStatus() {
  const { user } = useAuth();

  const [patientId, setPatientId] = useState<string | null>(null);
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [locationHistory, setLocationHistory] = useState<Location[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      // Get patient ID
      const { data: patientData } = await supabase
        .from('patients')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!patientData) {
        setLoading(false);
        return;
      }

      setPatientId(patientData.id);

      // Get geofence
      const { data: geofenceData } = await supabase
        .from('geofences')
        .select('home_lat, home_lng, radius')
        .eq('patient_id', patientData.id)
        .single();

      if (geofenceData) {
        setGeofence(geofenceData);
      }

      // Get location history
      const { data: locationData } = await supabase
        .from('location_logs')
        .select('lat, lng, created_at')
        .eq('patient_id', patientData.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (locationData) {
        setLocationHistory(locationData);
        if (locationData[0]) {
          setCurrentLocation(locationData[0]);
        }
      }

      // Get alerts
      const { data: alertsData } = await supabase
        .from('alerts')
        .select('id, status, message, created_at, resolved_at')
        .eq('patient_id', patientData.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (alertsData) {
        setAlerts(alertsData);
      }

      setLoading(false);
    };

    fetchData();

    // Real-time subscription for location updates
    const locationChannel = supabase
      .channel('patient-status-locations')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'location_logs' },
        (payload) => {
          const newLoc = payload.new as Location;
          setCurrentLocation(newLoc);
          setLocationHistory((prev) => [newLoc, ...prev.slice(0, 19)]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(locationChannel);
    };
  }, [user]);

  const isSafe = currentLocation && geofence
    ? isWithinGeofence(
        currentLocation.lat,
        currentLocation.lng,
        geofence.home_lat,
        geofence.home_lng,
        geofence.radius
      )
    : null;

  const distanceFromHome = currentLocation && geofence
    ? Math.round(
        calculateDistance(
          currentLocation.lat,
          currentLocation.lng,
          geofence.home_lat,
          geofence.home_lng
        )
      )
    : null;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Status</h1>
          <p className="text-muted-foreground">Detailed view of your safety status</p>
        </div>

        {/* Main Status Card */}
        <Card className={isSafe === false ? 'border-destructive bg-destructive/5' : isSafe === true ? 'border-green-500 bg-green-50' : ''}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Current Status
              </span>
              {isSafe !== null && (
                isSafe ? (
                  <Badge variant="secondary" className="gap-1 bg-green-100 text-green-700">
                    <CheckCircle className="h-4 w-4" />
                    SAFE
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-4 w-4" />
                    WARNING
                  </Badge>
                )
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Distance from Home</p>
                <p className="text-2xl font-bold">
                  {distanceFromHome !== null ? `${distanceFromHome}m` : '--'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Safe Zone Radius</p>
                <p className="text-2xl font-bold">
                  {geofence ? `${geofence.radius}m` : '--'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Current Coordinates</p>
                <p className="font-mono text-sm">
                  {currentLocation
                    ? `${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}`
                    : '--'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Last Updated</p>
                <p className="text-sm font-medium">
                  {currentLocation
                    ? new Date(currentLocation.created_at).toLocaleString()
                    : '--'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Location History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Location History
              </CardTitle>
              <CardDescription>Your recent location updates</CardDescription>
            </CardHeader>
            <CardContent>
              {locationHistory.length === 0 ? (
                <p className="text-muted-foreground">No location history yet</p>
              ) : (
                <div className="max-h-[300px] space-y-2 overflow-y-auto">
                  {locationHistory.map((loc, idx) => {
                    const locIsSafe = geofence
                      ? isWithinGeofence(loc.lat, loc.lng, geofence.home_lat, geofence.home_lng, geofence.radius)
                      : null;
                    
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="flex items-center gap-3">
                          <MapPin className={`h-4 w-4 ${locIsSafe ? 'text-green-500' : locIsSafe === false ? 'text-destructive' : 'text-muted-foreground'}`} />
                          <div>
                            <p className="font-mono text-sm">
                              {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                            </p>
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {new Date(loc.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        {locIsSafe !== null && (
                          locIsSafe ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Alert History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Alert History
              </CardTitle>
              <CardDescription>Past geofence breach alerts</CardDescription>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <CheckCircle className="mb-2 h-8 w-8 text-green-500" />
                  <p className="text-muted-foreground">No alerts recorded</p>
                  <p className="text-sm text-muted-foreground">Keep it up!</p>
                </div>
              ) : (
                <div className="max-h-[300px] space-y-2 overflow-y-auto">
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`rounded-lg border p-3 ${
                        alert.status === 'active' ? 'border-destructive bg-destructive/5' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-2">
                          {alert.status === 'active' ? (
                            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                          ) : (
                            <CheckCircle className="mt-0.5 h-4 w-4 text-green-500" />
                          )}
                          <div>
                            <p className="text-sm font-medium">
                              {alert.status === 'active' ? 'Outside Safe Zone' : 'Resolved'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Created: {new Date(alert.created_at).toLocaleString()}
                            </p>
                            {alert.resolved_at && (
                              <p className="text-xs text-green-600">
                                Resolved: {new Date(alert.resolved_at).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge variant={alert.status === 'active' ? 'destructive' : 'outline'}>
                          {alert.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Geofence Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5" />
              Geofence Configuration
            </CardTitle>
            <CardDescription>Your safe zone settings (managed by your caregiver)</CardDescription>
          </CardHeader>
          <CardContent>
            {geofence ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Home Latitude</p>
                  <p className="font-mono font-medium">{geofence.home_lat.toFixed(6)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Home Longitude</p>
                  <p className="font-mono font-medium">{geofence.home_lng.toFixed(6)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Safe Zone Radius</p>
                  <p className="font-medium">{geofence.radius} meters</p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">
                No geofence configured. Please wait for your caregiver to set up your safe zone.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
