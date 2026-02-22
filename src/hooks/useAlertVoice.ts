import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { registerManagedAudio, unregisterManagedAudio } from '@/lib/audioManager';

export type AlertSoundId =
  | 'medicine_and_zone'
  | 'medicine_only'
  | 'outside_zone'
  | 'correct'
  | 'incorrect';

type PlayAlertOptions = {
  cooldownMs?: number;
};

const BASE_ALERT_BEEP =
  'data:audio/wav;base64,UklGRlQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YTAAAAAAABEREQAAERERAAAREREAABEREQAAERERAAAREREAABEREQAAERERAAAREREA';

const ALERT_SOUND_LIBRARY: Record<AlertSoundId, string> = {
  medicine_and_zone: BASE_ALERT_BEEP,
  medicine_only: BASE_ALERT_BEEP,
  outside_zone: BASE_ALERT_BEEP,
  correct: '/audio/answers/correct_answer.mp3',
  incorrect: '/audio/answers/incorrect_answer.mp3',
};

export function useAlertVoice() {
  const location = useLocation();
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayedAtRef = useRef<Record<AlertSoundId, number>>({
    medicine_and_zone: 0,
    medicine_only: 0,
    outside_zone: 0,
    correct: 0,
    incorrect: 0,
  });

  const stop = useCallback(() => {
    if (!activeAudioRef.current) {
      return;
    }

    unregisterManagedAudio(activeAudioRef.current);
    activeAudioRef.current.pause();
    activeAudioRef.current.currentTime = 0;
    activeAudioRef.current.onended = null;
    activeAudioRef.current.onerror = null;
    activeAudioRef.current = null;
  }, []);

  const playAlert = useCallback(
    async (soundId: AlertSoundId, options?: PlayAlertOptions) => {
      const cooldownMs = options?.cooldownMs ?? 20_000;
      const now = Date.now();
      if (now - lastPlayedAtRef.current[soundId] < cooldownMs) {
        return false;
      }

      stop();

      const audio = new Audio(ALERT_SOUND_LIBRARY[soundId]);
      audio.preload = 'auto';
      activeAudioRef.current = audio;
      registerManagedAudio(audio);

      const clearActive = () => {
        if (activeAudioRef.current === audio) {
          unregisterManagedAudio(audio);
          activeAudioRef.current = null;
        }
      };

      audio.onended = clearActive;
      audio.onerror = clearActive;

      try {
        await audio.play();
        lastPlayedAtRef.current[soundId] = now;
        return true;
      } catch {
        clearActive();
        return false;
      }
    },
    [stop]
  );

  useEffect(() => stop, [stop]);

  useEffect(() => {
    stop();
  }, [location.pathname, stop]);

  return {
    playAlert,
    stop,
  };
}
