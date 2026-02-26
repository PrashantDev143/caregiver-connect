import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, HeartPulse, Loader2, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'caregiver' | 'patient';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<AppRole>('patient');
  const [isLoading, setIsLoading] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const { signUp, user, role: resolvedRole, loading, initializing } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const authChecking = initializing || loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setSettingUp(false);

    const { error } = await signUp(email, password, name, role);

    if (error) {
      const msg = typeof error.message === 'string' ? error.message : '';
      const status = (error as { status?: number }).status;
      const isRateLimit = /rate limit|rate_limit/i.test(msg);
      const isDbTriggerFailure =
        status === 500 || /database error saving new user/i.test(msg);
      toast({
        variant: 'destructive',
        title: 'Signup failed',
        description: isRateLimit
          ? 'Too many signup attempts. Please wait a few minutes or try a different email.'
          : isDbTriggerFailure
          ? 'Supabase signup trigger failed (500). Apply the latest SQL migration for handle_new_user/user_roles and try again.'
          : msg || 'Something went wrong.',
      });
      setIsLoading(false);
      return;
    }

    toast({
      title: 'Account created',
      description: 'Setting up your account...',
    });
    setSettingUp(true);
    setIsLoading(false);
  };

  useEffect(() => {
    if (authChecking || !user || !resolvedRole) {
      return;
    }

    const uid = user.id;
    console.log('[Signup] session + role ready:', { auth_uid: uid, role: resolvedRole });

    const verifyAndRedirect = async () => {
      if (resolvedRole === 'caregiver') {
        const { data: caregiver } = await supabase
          .from('caregivers')
          .select('id')
          .eq('user_id', uid)
          .single();
        console.log('[Signup] caregiver row:', caregiver ? { caregiver_id: caregiver.id } : 'missing');
      } else {
        const { data: patient } = await supabase
          .from('patients')
          .select('id')
          .eq('user_id', uid)
          .single();
        console.log('[Signup] patient row:', patient ? { patient_id: patient.id } : 'missing');
      }

      if (resolvedRole === 'caregiver') {
        navigate('/caregiver/dashboard', { replace: true });
      } else {
        navigate('/patient/dashboard', { replace: true });
      }
    };

    void verifyAndRedirect();
  }, [authChecking, user, resolvedRole, navigate]);

  const showSettingUp = settingUp && (authChecking || !resolvedRole);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_18%_18%,hsl(192_95%_90%),transparent_45%),radial-gradient(circle_at_85%_85%,hsl(150_72%_87%),transparent_42%),hsl(var(--background))] p-4 sm:p-6">
      <div className="pointer-events-none absolute -left-24 top-8 h-56 w-56 rounded-full bg-cyan-300/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-emerald-300/25 blur-3xl" />

      <Card className="w-full max-w-lg rounded-3xl border-white/60 bg-white/85 shadow-[0_24px_70px_-25px_rgba(14,165,233,0.45)] backdrop-blur transition-all duration-300 hover:-translate-y-1">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <img src="/spark-logo.svg" alt="Spark logo" className="h-9 w-9 object-contain" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">Create Your Account</CardTitle>
          <CardDescription className="text-sm">
            Join Caregiver-Connect to build safe, supportive daily routines.
          </CardDescription>
        </CardHeader>

        {showSettingUp ? (
          <CardContent className="flex flex-col items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-sm font-medium text-foreground">Setting up your account</p>
            <p className="mt-1 text-xs text-muted-foreground">Finalizing role permissions and profile data.</p>
          </CardContent>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-11 rounded-xl border-border/70 bg-white/80 transition-all duration-200 focus-visible:scale-[1.01] focus-visible:border-primary/70 focus-visible:ring-primary/30"
                />
              </div>

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
                  placeholder="Minimum 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={isLoading}
                  className="h-11 rounded-xl border-border/70 bg-white/80 transition-all duration-200 focus-visible:scale-[1.01] focus-visible:border-primary/70 focus-visible:ring-primary/30"
                />
              </div>

              <div className="space-y-3">
                <Label>I am a...</Label>
                <RadioGroup
                  value={role}
                  onValueChange={(value) => setRole(value as AppRole)}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                >
                  <div>
                    <RadioGroupItem
                      value="caregiver"
                      id="caregiver"
                      className="peer sr-only"
                      disabled={isLoading}
                    />
                    <Label
                      htmlFor="caregiver"
                      className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-muted bg-white p-4 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-sm peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
                    >
                      <User className="mb-2 h-6 w-6 text-primary" />
                      <span className="text-sm font-semibold">Caregiver</span>
                      <span className="text-xs text-muted-foreground">Monitor and support patients</span>
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem
                      value="patient"
                      id="patient"
                      className="peer sr-only"
                      disabled={isLoading}
                    />
                    <Label
                      htmlFor="patient"
                      className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-muted bg-white p-4 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-sm peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
                    >
                      <HeartPulse className="mb-2 h-6 w-6 text-primary" />
                      <span className="text-sm font-semibold">Patient</span>
                      <span className="text-xs text-muted-foreground">Share updates and stay connected</span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                <p className="flex items-center gap-2 text-xs text-primary/90">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Secure authentication with role-based access for trusted care teams.
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
                    Creating account...
                  </>
                ) : (
                  <>
                    Create Account
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link to="/login" className="font-semibold text-primary transition-colors hover:text-primary/80">
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
