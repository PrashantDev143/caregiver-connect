import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { Shield, User, HeartPulse } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'caregiver' | 'patient';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<AppRole>('patient');
  const [isLoading, setIsLoading] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const { signUp, user, role: resolvedRole, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setSettingUp(false);

    const { data, error } = await signUp(email, password, name, role);

    if (error) {
      const msg = typeof error.message === 'string' ? error.message : '';
      const isRateLimit = /rate limit|rate_limit/i.test(msg);
      toast({
        variant: 'destructive',
        title: 'Signup failed',
        description: isRateLimit
          ? 'Too many signup attempts. Please wait a few minutes or try a different email.'
          : msg || 'Something went wrong.',
      });
      setIsLoading(false);
      return;
    }

    toast({
      title: 'Account created',
      description: 'Setting up your account…',
    });
    setSettingUp(true);
    setIsLoading(false);
  };

  useEffect(() => {
    if (loading || !user || !resolvedRole) return;

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

    verifyAndRedirect();
  }, [loading, user, resolvedRole, navigate]);

  const showSettingUp = settingUp && (loading || !resolvedRole);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/10 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Create Account</CardTitle>
          <CardDescription>
            Join SafeZone to keep your loved ones safe
          </CardDescription>
        </CardHeader>
        {showSettingUp ? (
          <CardContent className="flex flex-col items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="mt-4 text-muted-foreground">Setting up your account…</p>
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
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-3">
                <Label>I am a...</Label>
                <RadioGroup
                  value={role}
                  onValueChange={(value) => setRole(value as AppRole)}
                  className="grid grid-cols-2 gap-4"
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
                      className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                    >
                      <User className="mb-2 h-6 w-6" />
                      <span className="text-sm font-medium">Caregiver</span>
                      <span className="text-xs text-muted-foreground">Monitor patients</span>
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
                      className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                    >
                      <HeartPulse className="mb-2 h-6 w-6" />
                      <span className="text-sm font-medium">Patient</span>
                      <span className="text-xs text-muted-foreground">Share location</span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Creating account...' : 'Create Account'}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-primary hover:underline">
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
