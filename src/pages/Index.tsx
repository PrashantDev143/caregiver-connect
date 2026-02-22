import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { ArrowRight, Users, MapPin, Bell } from 'lucide-react';

const Index = () => {
  const { user, role, loading, initializing } = useAuth();
  const navigate = useNavigate();
  const authChecking = initializing || loading;

  useEffect(() => {
    if (authChecking || !user || !role) {
      return;
    }

    if (role === 'caregiver') {
      navigate('/caregiver/dashboard', { replace: true });
      return;
    }

    navigate('/patient/dashboard', { replace: true });
  }, [authChecking, user, role, navigate]);

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/10">
      {/* Header */}
      <header className="container mx-auto flex items-center justify-between p-6">
        <div className="flex items-center gap-2">
          <img src="/spark-logo.svg" alt="Spark logo" className="h-8 w-8 object-contain" />
          <span className="text-xl font-bold">SPARK</span>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" asChild>
            <Link to="/login">Sign In</Link>
          </Button>
          <Button asChild>
            <Link to="/signup">Get Started</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <main className="container mx-auto px-6 py-16 text-center">
        <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          Keep Your Loved Ones
          <span className="block text-primary">Safe & Connected</span>
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
          SPARK helps caregivers monitor patient locations in real-time with intelligent geofencing.
          Receive instant alerts when patients leave their designated safe areas.
        </p>
        <div className="flex flex-col justify-center gap-4 sm:flex-row">
          <Button size="lg" asChild>
            <Link to="/signup">
              Start Free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/login">Sign In</Link>
          </Button>
        </div>

        {/* Features */}
        <div className="mx-auto mt-24 grid max-w-4xl gap-8 md:grid-cols-3">
          <div className="rounded-xl border bg-card p-6 text-left shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Patient Management</h3>
            <p className="text-sm text-muted-foreground">
              Easily add and manage multiple patients. Track their status from a single dashboard.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-6 text-left shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <MapPin className="h-6 w-6 text-primary" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Smart Geofencing</h3>
            <p className="text-sm text-muted-foreground">
              Define custom safe zones with interactive maps. Adjust radius based on patient needs.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-6 text-left shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <Bell className="h-6 w-6 text-primary" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Real-time Alerts</h3>
            <p className="text-sm text-muted-foreground">
              Get instant notifications when patients leave their safe zones. Never miss a critical moment.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="container mx-auto border-t p-6 text-center text-sm text-muted-foreground">
        <div className="mb-2 flex items-center justify-center gap-2">
          <img src="/spark-logo.svg" alt="Spark logo" className="h-5 w-5 object-contain" />
          <span className="font-medium">SPARK</span>
        </div>
        <p>© 2024 SPARK. Caregiver-Patient Geofencing Safety System.</p>
      </footer>
    </div>
  );
};

export default Index;
