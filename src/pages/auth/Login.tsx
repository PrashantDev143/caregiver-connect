import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { signIn, role, user, loading, initializing } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const authChecking = initializing || loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Login failed',
        description: error.message,
      });
      setIsLoading(false);
      return;
    }

    toast({
      title: 'Welcome back!',
      description: 'Setting up your dashboard...',
    });

    setIsLoading(false);
  };

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

  const waitingForRole = user && authChecking;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_20%_15%,hsl(195_95%_90%),transparent_45%),radial-gradient(circle_at_80%_85%,hsl(152_80%_88%),transparent_42%),hsl(var(--background))] p-4 sm:p-6">
      <div className="pointer-events-none absolute -left-24 top-10 h-52 w-52 rounded-full bg-cyan-300/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-60 w-60 rounded-full bg-emerald-300/25 blur-3xl" />

      <Card className="w-full max-w-md rounded-3xl border-white/60 bg-white/85 shadow-[0_24px_70px_-25px_rgba(6,182,212,0.45)] backdrop-blur transition-all duration-300 hover:-translate-y-1">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <img src="/spark-logo.svg" alt="Spark logo" className="h-9 w-9 object-contain" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">Welcome Back</CardTitle>
          <CardDescription className="text-sm">
            Sign in to continue your care journey with calm, real-time support.
          </CardDescription>
        </CardHeader>

        {waitingForRole ? (
          <CardContent className="flex flex-col items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-sm font-medium text-foreground">Preparing your dashboard</p>
            <p className="mt-1 text-xs text-muted-foreground">Syncing your account and permissions.</p>
          </CardContent>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-11 rounded-xl border-border/70 bg-white/80 transition-all duration-200 focus-visible:scale-[1.01] focus-visible:border-primary/70 focus-visible:ring-primary/30"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="........"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-11 rounded-xl border-border/70 bg-white/80 transition-all duration-200 focus-visible:scale-[1.01] focus-visible:border-primary/70 focus-visible:ring-primary/30"
                />
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                <p className="flex items-center gap-2 text-xs text-primary/90">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Your data is protected and only shared with authorized caregivers.
                </p>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-4">
              <Button
                type="submit"
                className="h-11 w-full rounded-xl text-base font-semibold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                New to Caregiver-Connect?{' '}
                <Link to="/signup" className="font-semibold text-primary transition-colors hover:text-primary/80">
                  Create an account
                </Link>
              </p>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
