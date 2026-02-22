import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_ROUNDS, type GameRound, type RoundOption } from "@/components/games/GameHelpers";
import { registerManagedAudio, unregisterManagedAudio } from "@/lib/audioManager";

export type GameState = "AWAITING_AUDIO" | "PLAYING_AUDIO" | "SELECTING";

function getInitialGameState(round: GameRound): GameState {
  return round.audioUrl ? "AWAITING_AUDIO" : "SELECTING";
}

export function useSoundSleuth() {
  const [roundIndex, setRoundIndex] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isCorrectAnswer, setIsCorrectAnswer] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("Take your time. You are doing well.");
  const [gameState, setGameState] = useState<GameState>(getInitialGameState(GAME_ROUNDS[0]));
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentRound = GAME_ROUNDS[roundIndex];
  const totalRounds = GAME_ROUNDS.length;
  const isLastRound = roundIndex === totalRounds - 1;
  const showAudioControl = Boolean(currentRound.audioUrl);
  const canSelectOptions = gameState === "SELECTING" && !isAnswered;

  const clearCurrentAudio = useCallback(() => {
    if (!audioRef.current) return;
    unregisterManagedAudio(audioRef.current);
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    audioRef.current.onended = null;
    audioRef.current.onerror = null;
    audioRef.current = null;
  }, []);

  const playRoundAudioAsset = useCallback(
    (audioUrl: string) =>
      new Promise<void>((resolve) => {
        clearCurrentAudio();
        setGameState("PLAYING_AUDIO");
        try {
          const audio = new Audio(audioUrl);
          audio.preload = "auto";
          audioRef.current = audio;
          registerManagedAudio(audio);
          audio.onended = () => {
            unregisterManagedAudio(audio);
            setGameState("SELECTING");
            resolve();
          };
          audio.onerror = () => {
            console.log(`Audio failed to load: ${audioUrl}`);
            unregisterManagedAudio(audio);
            setFeedbackMessage("Audio unavailable. You can continue to choices.");
            setGameState("SELECTING");
            resolve();
          };
          void audio.play().catch((err) => {
            console.log(err);
            unregisterManagedAudio(audio);
            setFeedbackMessage("Audio could not play. You can continue to choices.");
            setGameState("SELECTING");
            resolve();
          });
        } catch {
          setFeedbackMessage("Audio could not start. You can continue to choices.");
          setGameState("SELECTING");
          resolve();
        }
      }),
    [clearCurrentAudio],
  );

  const moveToNextRound = useCallback(() => {
    clearCurrentAudio();
    const nextRoundIndex = (roundIndex + 1) % totalRounds;
    const nextRound = GAME_ROUNDS[nextRoundIndex];

    setRoundIndex(nextRoundIndex);
    setSelectedOptionId(null);
    setIsAnswered(false);
    setIsCorrectAnswer(false);
    setFeedbackMessage("Take your time. You are doing well.");
    setGameState(getInitialGameState(nextRound));
  }, [clearCurrentAudio, roundIndex, totalRounds]);

  const handleGuess = useCallback(
    (option: RoundOption) => {
      if (!canSelectOptions) return;
      setSelectedOptionId(option.id);
      const isCorrect = option.id === currentRound.answerOptionId;
      setIsAnswered(true);
      setIsCorrectAnswer(isCorrect);
      setFeedbackMessage(isCorrect ? currentRound.successMessage : currentRound.retryMessage);
    },
    [canSelectOptions, currentRound.answerOptionId, currentRound.retryMessage, currentRound.successMessage],
  );

  const playAudio = useCallback(() => {
    if (!currentRound.audioUrl) return;
    void playRoundAudioAsset(currentRound.audioUrl);
  }, [currentRound.audioUrl, playRoundAudioAsset]);

  const unlockSelection = useCallback(() => {
    clearCurrentAudio();
    setSelectedOptionId(null);
    setIsAnswered(false);
    setIsCorrectAnswer(false);
    setGameState("SELECTING");
    setFeedbackMessage("Try one more time.");
  }, [clearCurrentAudio]);

  useEffect(() => {
    return () => {
      clearCurrentAudio();
    };
  }, [clearCurrentAudio]);

  useEffect(() => {
    const imageUrls = GAME_ROUNDS.flatMap((round) => round.options.map((option) => option.imageUrl));
    const audioUrls = GAME_ROUNDS.flatMap((round) => (round.audioUrl ? [round.audioUrl] : []));

    imageUrls.forEach((url) => {
      const image = new Image();
      image.src = url;
    });

    audioUrls.forEach((url) => {
      const audio = new Audio(url);
      audio.preload = "auto";
      audio.load();
    });
  }, []);

  const roundLabel = useMemo(() => `Round ${roundIndex + 1} of ${totalRounds}`, [roundIndex, totalRounds]);

  return {
    roundIndex,
    totalRounds,
    currentRound,
    feedbackMessage,
    gameState,
    handleGuess,
    isLastRound,
    isAnswered,
    isCorrectAnswer,
    moveToNextRound,
    playAudio,
    roundLabel,
    selectedOptionId,
    showAudioControl,
    canSelectOptions,
    unlockSelection,
  };
}
