import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GameComponent } from "@/components/games/GameComponent";
import { GAME_TYPE_MEMORY } from "@/components/games/GameHelpers";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

export default function PatientGamePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasSavedRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("id, caregiver_id")
        .eq("user_id", user.id)
        .single();

      if (error || !data) {
        toast({
          variant: "destructive",
          title: "Unable to load game profile",
          description: error?.message ?? "Patient profile not found.",
        });
        setLoading(false);
        return;
      }

      setPatientId(data.id);
      setCaregiverId(data.caregiver_id);
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
      <div className="space-y-5">
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-cyan-500/10 via-background to-emerald-500/10 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Memory Game</h1>
              <p className="text-sm text-muted-foreground">Enjoy a short brain-boosting session and celebrate each win.</p>
            </div>
            <Button asChild variant="outline" className="rounded-xl transition-all duration-200 hover:-translate-y-0.5">
              <Link to="/patient/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </div>

        {loading ? (
          <Card className="border-primary/20 shadow-sm">
            <CardHeader>
              <CardTitle>Loading game...</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="text-sm text-muted-foreground">Preparing your session.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <GameComponent onSessionComplete={saveFinalScore} />
        )}
      </div>
    </DashboardLayout>
  );
}
