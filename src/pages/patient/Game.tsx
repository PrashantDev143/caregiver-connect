import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GameComponent } from "@/components/games/GameComponent";
import { BrainGamesSection } from "@/components/games/BrainGamesSection";
import { GAME_TYPE_MEMORY } from "@/components/games/GameHelpers";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { stopAllAudioPlayback } from "@/lib/audioManager";

export default function PatientGamePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [assistantActive, setAssistantActive] = useState(false);
  const hasSavedRef = useRef(false);

  useEffect(() => {
    setAssistantActive(true);
    return () => {
      stopAllAudioPlayback();
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    const ensurePatientRow = async () => {
      const displayName =
        (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
        user.email?.split('@')[0] ||
        'Patient';

      return supabase
        .from('patients')
        .upsert(
          {
            user_id: user.id,
            name: displayName,
            email: user.email ?? '',
          },
          { onConflict: 'user_id' }
        )
        .select('id, caregiver_id')
        .maybeSingle();
    };

    const load = async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("id, caregiver_id")
        .eq("user_id", user.id)
        .maybeSingle();

      let resolved = data;
      if (!resolved) {
        const created = await ensurePatientRow();
        resolved = created.data ?? null;
      }

      if (error || !resolved) {
        toast({
          variant: "destructive",
          title: "Unable to load game profile",
          description: error?.message ?? "Patient profile not found.",
        });
        setLoading(false);
        return;
      }

      setPatientId(resolved.id);
      setCaregiverId(resolved.caregiver_id);
      setLoading(false);
    };

    void load();
  }, [toast, user]);

  const saveFinalScore = async (score: number) => {
    if (hasSavedRef.current || !patientId || !caregiverId) return;

    const { error } = await supabase.from("game_scores").insert({
      patient_id: patientId,
      caregiver_id: caregiverId,
      game_type: GAME_TYPE_MEMORY,
      score,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Failed to save score",
        description: error.message,
      });
      return;
    }

    hasSavedRef.current = true;
    toast({
      title: "Score saved",
      description: `Your final score (${score}) was recorded.`,
    });
  };

  return (
    <DashboardLayout>
      <div className="patient-readable mx-auto w-full max-w-4xl space-y-4 px-3 py-5 sm:space-y-5 sm:px-6 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-white/75 px-4 py-4 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold tracking-[0.01em] text-slate-900 sm:text-3xl">Games Center</h1>
            <p className="text-base text-slate-700 sm:text-lg">Play all available games from one place.</p>
          </div>
          <Button asChild variant="outline" className="h-11 w-full rounded-xl text-base sm:w-auto sm:text-lg">
            <Link to="/patient/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
        </div>

        <BrainGamesSection className="soft-appear patient-readable" />

        {loading ? (
          <Card className="border-primary/20 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl tracking-[0.01em] sm:text-2xl">Loading memory game...</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="text-base text-muted-foreground sm:text-lg">Preparing your session.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <h2 className="text-xl font-semibold tracking-[0.01em] sm:text-2xl">Memory Card Matching</h2>
            <GameComponent onSessionComplete={saveFinalScore} assistantActive={assistantActive} />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
