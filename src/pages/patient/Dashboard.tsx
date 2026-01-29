import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapContainer } from '@/components/map/MapContainer';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { calculateDistance, isWithinGeofence } from '@/utils/distance';
import { useToast } from '@/hooks/use-toast';
import {
  MapPin,
  AlertTriangle,
  CheckCircle,
  Navigation,
  Clock,
  Home,
  Wifi,
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

export default function PatientDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [patientId, setPatientId] = useState<string | null>(null);
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastAlertStatus, setLastAlertStatus] = useState<boolean | null>(null);

  const defaultCenter: [number, number] = [51.505, -0.09];

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

      // Get latest location
      const { data: locationData } = await supabase
        .from('location_logs')
        .select('lat, lng, created_at')
        .eq('patient_id', patientData.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (locationData?.[0]) {
        setCurrentLocation(locationData[0]);
      }

      setLoading(false);
    };

    fetchData();
  }, [user]);

  // Check for geofence breach and create/resolve alerts
  const checkGeofenceStatus = async (lat: number, lng: number) => {
    if (!geofence || !patientId) return;

    const isInside = isWithinGeofence(lat, lng, geofence.home_lat, geofence.home_lng, geofence.radius);

    // Only trigger on state change
    if (lastAlertStatus === null) {
      setLastAlertStatus(isInside);
      return;
    }

    if (!isInside && lastAlertStatus) {
      // Went from inside to outside - create alert
      await supabase.from('alerts').insert({
        patient_id: patientId,
        status: 'active',
        message: 'Patient left the safe zone',
      });

      toast({
        variant: 'destructive',
        title: 'Warning!',
        description: 'You have left your safe zone.',
      });
    } else if (isInside && !lastAlertStatus) {
      // Went from outside to inside - resolve alerts
      await supabase
        .from('alerts')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .eq('patient_id', patientId)
        .eq('status', 'active');

      toast({
        title: 'Safe!',
        description: 'You are back in your safe zone.',
      });
    }

    setLastAlertStatus(isInside);
  };

  // Simulate location update
  const simulateLocation = async (type: 'home' | 'random' | 'outside') => {
    if (!patientId || !geofence) {
      toast({
        variant: 'destructive',
        title: 'No geofence set',
        description: 'Your caregiver needs to set up a geofence first.',
      });
      return;
    }

    setIsSimulating(true);

    let lat: number, lng: number;

    if (type === 'home') {
      // At home location
      lat = geofence.home_lat + (Math.random() - 0.5) * 0.0001;
      lng = geofence.home_lng + (Math.random() - 0.5) * 0.0001;
    } else if (type === 'random') {
      // Random location within geofence
      const angle = Math.random() * 2 * Math.PI;
      const distance = Math.random() * (geofence.radius * 0.8); // 80% of radius max
      const earthRadius = 6371000;
      lat = geofence.home_lat + (distance / earthRadius) * (180 / Math.PI) * Math.cos(angle);
      lng = geofence.home_lng + (distance / earthRadius) * (180 / Math.PI) * Math.sin(angle) / Math.cos(geofence.home_lat * Math.PI / 180);
    } else {
      // Outside geofence
      const angle = Math.random() * 2 * Math.PI;
      const distance = geofence.radius + 100 + Math.random() * 200; // 100-300m outside
      const earthRadius = 6371000;
      lat = geofence.home_lat + (distance / earthRadius) * (180 / Math.PI) * Math.cos(angle);
      lng = geofence.home_lng + (distance / earthRadius) * (180 / Math.PI) * Math.sin(angle) / Math.cos(geofence.home_lat * Math.PI / 180);
    }

    // Insert location log
    const { error } = await supabase.from('location_logs').insert({
      patient_id: patientId,
      lat,
      lng,
    });

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update location.',
      });
      setIsSimulating(false);
      return;
    }

    const newLocation = { lat, lng, created_at: new Date().toISOString() };
    setCurrentLocation(newLocation);
    await checkGeofenceStatus(lat, lng);

    setIsSimulating(false);
  };

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

  const mapCenter: [number, number] = geofence
    ? [geofence.home_lat, geofence.home_lng]
    : currentLocation
    ? [currentLocation.lat, currentLocation.lng]
    : defaultCenter;

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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Dashboard</h1>
            <p className="text-muted-foreground">Monitor your safety status</p>
          </div>
          {isSafe !== null && (
            isSafe ? (
              <Badge variant="secondary" className="gap-2 bg-green-100 px-4 py-2 text-lg text-green-700">
                <CheckCircle className="h-5 w-5" />
                SAFE
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-2 px-4 py-2 text-lg">
                <AlertTriangle className="h-5 w-5" />
                WARNING
              </Badge>
            )
          )}
        </div>

        {/* Status Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Distance from Home</CardTitle>
              <Home className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {distanceFromHome !== null ? `${distanceFromHome}m` : '--'}
              </div>
              <p className="text-xs text-muted-foreground">
                {geofence ? `Safe zone: ${geofence.radius}m radius` : 'No geofence set'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Last Update</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {currentLocation
                  ? new Date(currentLocation.created_at).toLocaleTimeString()
                  : '--'}
              </div>
              <p className="text-xs text-muted-foreground">
                {currentLocation
                  ? new Date(currentLocation.created_at).toLocaleDateString()
                  : 'No location data'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Caregiver Status</CardTitle>
              <Wifi className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {geofence ? 'Connected' : 'Pending'}
              </div>
              <p className="text-xs text-muted-foreground">
                {geofence ? 'Geofence configured' : 'Waiting for caregiver setup'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Map */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Location Map
            </CardTitle>
            <CardDescription>
              Your current position relative to your safe zone
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MapContainer
              center={mapCenter}
              marker={geofence ? [geofence.home_lat, geofence.home_lng] : undefined}
              geofence={geofence ? { lat: geofence.home_lat, lng: geofence.home_lng, radius: geofence.radius } : undefined}
              patientLocation={currentLocation ?? undefined}
              className="h-[350px] w-full rounded-lg"
            />
          </CardContent>
        </Card>

        {/* Location Simulation (for demo) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Navigation className="h-5 w-5" />
              Location Simulation
            </CardTitle>
            <CardDescription>
              For demo purposes - simulate different location scenarios
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => simulateLocation('home')}
                disabled={isSimulating || !geofence}
              >
                <Home className="mr-2 h-4 w-4" />
                At Home
              </Button>
              <Button
                variant="outline"
                onClick={() => simulateLocation('random')}
                disabled={isSimulating || !geofence}
              >
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
              <p className="mt-3 text-sm text-muted-foreground">
                Your caregiver needs to set up a geofence before you can simulate locations.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
