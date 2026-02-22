import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles, Trophy, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { GAME_ROUNDS, calculateGameScore } from '@/components/games/GameHelpers';
import { useSoundSleuth } from '@/components/games/useSoundSleuth';
import { CelebrationOverlay } from '@/components/ui/celebration-overlay';
import { ResponsiveGameImage } from '@/components/games/ResponsiveGameImage';
import { useVoiceAssistant } from '@/hooks/useVoiceAssistant';

interface GameComponentProps {
  onSessionComplete: (finalScore: number) => Promise<void> | void;
}

export function GameComponent({ onSessionComplete }: GameComponentProps) {
  const [started, setStarted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [showRoundCelebration, setShowRoundCelebration] = useState(false);
  const [scoreBumpToken, setScoreBumpToken] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isRestarting, setIsRestarting] = useState(false);
  const correctRoundIdsRef = useRef<Set<string>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  const spokenRoundRef = useRef<number | null>(null);
  const spokenAnswerKeyRef = useRef<string>('');

  const {
    roundIndex,
    totalRounds,
    currentRound,
    roundLabel,
    feedbackMessage,
    gameState,
    showAudioControl,
    playAudio,
    handleGuess,
    isAnswered,
    isCorrectAnswer,
    isLastRound,
    moveToNextRound,
    selectedOptionId,
    canSelectOptions,
    unlockSelection,
  } = useSoundSleuth();

  const {
    speak,
    stop,
    isSupported: voiceSupported,
  } = useVoiceAssistant({
    enabled: soundEnabled,
    rate: 0.97,
    pitch: 1,
  });

  const coachingPraise = useMemo(
    () => [
      'Excellent work. That is the right answer.',
      'Great focus. You got it right.',
      'Wonderful job. Keep that rhythm going.',
      'Nice recall. You are doing very well.',
    ],
    []
  );

  const coachingRetry = useMemo(
    () => [
      'Good effort. Let us try one more time together.',
      'No problem. Take a slow breath and try again.',
      'You are doing fine. Please pick another option when ready.',
      'Nice attempt. We can try this round again.',
    ],
    []
  );

  const playWinTone = useCallback(() => {
    try {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;

      const context = audioContextRef.current ?? new AudioContextCtor();
      audioContextRef.current = context;
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();

      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(620, now);
      oscillator.frequency.exponentialRampToValueAtTime(980, now + 0.18);
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(0.1, now + 0.03);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.26);
    } catch {
      // Non-blocking optional sound hook.
    }
  }, []);

  useEffect(() => {
    if (!isAnswered || !isCorrectAnswer) return;
    if (correctRoundIdsRef.current.has(currentRound.id)) return;

    correctRoundIdsRef.current.add(currentRound.id);
    const nextCorrect = correctRoundIdsRef.current.size;
    setCorrectCount(nextCorrect);
    setShowRoundCelebration(true);
    setScoreBumpToken(Date.now());
    if (soundEnabled) playWinTone();

    const timer = window.setTimeout(() => setShowRoundCelebration(false), 1000);
    return () => window.clearTimeout(timer);
  }, [currentRound.id, isAnswered, isCorrectAnswer, playWinTone, soundEnabled]);

  useEffect(() => {
    if (scoreBumpToken === null) return;
    const timer = window.setTimeout(() => setScoreBumpToken(null), 720);
    return () => window.clearTimeout(timer);
  }, [scoreBumpToken]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
      stop();
    };
  }, [stop]);

  useEffect(() => {
    if (!started || completed || !soundEnabled) return;
    speak('Welcome to your memory game. I will guide you through each round.', { interrupt: true });
  }, [completed, soundEnabled, speak, started]);

  useEffect(() => {
    if (!started || completed || !soundEnabled) return;
    if (spokenRoundRef.current === roundIndex || gameState !== 'SELECTING') return;

    spokenRoundRef.current = roundIndex;
    speak(`${roundLabel}. ${currentRound.prompt} ${currentRound.calmingTip}`, { interrupt: true, rate: 0.95 });
  }, [completed, currentRound.calmingTip, currentRound.prompt, gameState, roundIndex, roundLabel, soundEnabled, speak, started]);

  useEffect(() => {
    if (!started || completed || !soundEnabled || !isAnswered) return;
    const answerKey = `${currentRound.id}:${selectedOptionId ?? ''}`;
    if (spokenAnswerKeyRef.current === answerKey) return;
    spokenAnswerKeyRef.current = answerKey;

    if (isCorrectAnswer) {
      const praise = coachingPraise[Math.floor(Math.random() * coachingPraise.length)];
      speak(`${praise} ${currentRound.successMessage}`, { interrupt: true, rate: 0.98 });
      return;
    }

    const retry = coachingRetry[Math.floor(Math.random() * coachingRetry.length)];
    speak(`${retry} ${currentRound.retryMessage}`, { interrupt: true, rate: 0.95 });
  }, [
    coachingPraise,
    coachingRetry,
    completed,
    currentRound.id,
    currentRound.retryMessage,
    currentRound.successMessage,
    isAnswered,
    isCorrectAnswer,
    selectedOptionId,
    soundEnabled,
    speak,
    started,
  ]);

  useEffect(() => {
    if (!completed || finalScore === null || !soundEnabled) return;
    speak(`Session complete. Your final score is ${finalScore}. Great effort today.`, { interrupt: true });
  }, [completed, finalScore, soundEnabled, speak]);

  const finalizeSession = useCallback(async () => {
    const score = calculateGameScore(correctRoundIdsRef.current.size, GAME_ROUNDS.length);
    setFinalScore(score);
    setCompleted(true);
    if (!submitted) {
      setSubmitting(true);
      await onSessionComplete(score);
      setSubmitting(false);
      setSubmitted(true);
    }
  }, [onSessionComplete, submitted]);

  const onNext = async () => {
    if (isLastRound) {
      await finalizeSession();
      return;
    }
    spokenAnswerKeyRef.current = '';
    moveToNextRound();
  };

  const restart = () => {
    setIsRestarting(true);
    window.setTimeout(() => {
      window.location.reload();
    }, 220);
  };

  const roundProgress = ((roundIndex + (isAnswered ? 1 : 0)) / totalRounds) * 100;
  const scorePreview = useMemo(() => calculateGameScore(correctCount, totalRounds), [correctCount, totalRounds]);

  if (!started) {
    return (
      <Card className="overflow-hidden border-cyan-300/30 bg-gradient-to-br from-cyan-500/10 via-background to-emerald-500/10 shadow-lg">
        <CardHeader className="space-y-3">
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="h-5 w-5 text-primary" />
            Memory Game
          </CardTitle>
          <CardDescription>Listen, identify, and recall familiar people, places, and objects.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-primary/20 bg-background/80 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Quick warm-up</p>
            <p className="mt-1">Each correct answer improves your score. Take your time and enjoy each round.</p>
          </div>
          <Button
            onClick={() => setStarted(true)}
            className="h-11 rounded-xl text-base font-semibold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
          >
            Start Game
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (completed) {
    return (
      <Card className="relative overflow-hidden border-emerald-300/30 bg-gradient-to-br from-emerald-500/10 via-background to-cyan-500/10 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-emerald-600" />
            Session Complete
          </CardTitle>
          <CardDescription>You finished all rounds. Keep building momentum.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-50 p-4">
            <p className="text-sm text-emerald-700">Final Score</p>
            <p className="text-3xl font-bold text-emerald-700">{finalScore ?? 0}</p>
          </div>
          {submitting ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving score...
            </p>
          ) : null}
          <Button
            variant="outline"
            onClick={restart}
            className="h-11 rounded-xl transition-all duration-200 hover:-translate-y-0.5"
          >
            Play Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`relative overflow-hidden border-primary/20 shadow-lg transition-all duration-300 hover:shadow-xl ${isRestarting ? 'opacity-70' : 'opacity-100'}`}>
      <CelebrationOverlay
        active={showRoundCelebration}
        message="Great answer!"
        submessage="Score increased"
        particleCount={24}
      />

      <CardHeader className="space-y-4 bg-gradient-to-r from-cyan-500/10 via-background to-emerald-500/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Memory Game</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSoundEnabled((prev) => !prev)}
            className="h-8 rounded-full px-3"
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            {soundEnabled ? 'Voice on' : 'Voice off'}
          </Button>
        </div>
        <CardDescription>{roundLabel}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-5">
        <div className="relative rounded-xl border border-primary/15 bg-primary/5 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Current score</p>
            <p className="text-2xl font-bold text-primary">{scorePreview}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Correct answers: {correctCount} / {totalRounds}</p>
          <Progress value={roundProgress} className="mt-3 h-2 bg-primary/10" />
          {scoreBumpToken && (
            <p key={scoreBumpToken} className="score-bump absolute right-4 top-3 text-sm font-bold text-emerald-600">
              +1
            </p>
          )}
        </div>

        <p className="text-base font-semibold">{currentRound.prompt}</p>
        <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {currentRound.calmingTip}
        </p>

        {showAudioControl ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={playAudio} className="rounded-xl">
              Play Audio
            </Button>
            {voiceSupported ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => speak(`${currentRound.prompt} ${currentRound.calmingTip}`, { interrupt: true, rate: 0.95 })}
                className="rounded-xl"
              >
                Hear Prompt
              </Button>
            ) : null}
            {gameState === 'PLAYING_AUDIO' ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Listening...
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {currentRound.options.map((option) => {
            const selected = option.id === selectedOptionId;
            const showCorrectAnswer = isAnswered && option.id === currentRound.answerOptionId;
            const showIncorrectSelection = isAnswered && selected && !isCorrectAnswer;

            return (
              <button
                key={option.id}
                type="button"
                className={`group rounded-xl border p-3 text-left transition-all duration-200 ${
                  selected ? 'border-primary bg-primary/10' : 'border-border bg-background'
                } ${
                  showCorrectAnswer ? 'border-emerald-500/50 bg-emerald-50' : ''
                } ${
                  showIncorrectSelection ? 'border-amber-500/50 bg-amber-50' : ''
                } ${canSelectOptions ? 'hover:-translate-y-0.5 hover:shadow-md' : ''}`}
                disabled={!canSelectOptions}
                onClick={() => handleGuess(option)}
              >
                <div className="mb-2 aspect-[4/3] w-full overflow-hidden rounded-lg">
                  <ResponsiveGameImage
                    src={option.imageUrl}
                    alt={option.label}
                    fit="cover"
                    className="h-full w-full rounded-lg"
                    imageClassName="transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                </div>
                <p className="font-medium">{option.label}</p>
                <p className="text-xs text-muted-foreground">{option.id}</p>
              </button>
            );
          })}
        </div>

        {isAnswered ? (
          <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
            <p className={`font-medium ${isCorrectAnswer ? 'text-emerald-700' : 'text-amber-700'}`}>{feedbackMessage}</p>
            <div className="flex flex-wrap gap-2">
              {!isCorrectAnswer ? (
                <Button variant="outline" onClick={unlockSelection} className="rounded-xl">
                  Try Again
                </Button>
              ) : null}
              <Button onClick={onNext} className="rounded-xl">
                {isLastRound ? 'Finish Game' : 'Next Round'}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
