import { useCallback, useEffect, useMemo, useState } from 'react';

interface UseVoiceAssistantOptions {
  active?: boolean;
  enabled: boolean;
  rate?: number;
  pitch?: number;
  volume?: number;
  lang?: string;
}

interface SpeakOptions {
  interrupt?: boolean;
  rate?: number;
  pitch?: number;
}

export function useVoiceAssistant({
  active = true,
  enabled,
  rate = 0.96,
  pitch = 1,
  volume = 1,
  lang = 'en-US',
}: UseVoiceAssistantOptions) {
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');

  useEffect(() => {
    if (!active || !isSupported) return;

    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      setVoices(available);
      if (!selectedVoiceURI && available.length > 0) {
        const preferred =
          available.find((voice) => /en-/i.test(voice.lang) && /female|samantha|zira|aria|google us english/i.test(voice.name)) ??
          available.find((voice) => /en-/i.test(voice.lang)) ??
          available[0];
        setSelectedVoiceURI(preferred?.voiceURI ?? '');
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [active, isSupported, selectedVoiceURI]);

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.voiceURI === selectedVoiceURI),
    [selectedVoiceURI, voices]
  );

  const stop = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
  }, [isSupported]);

  const speak = useCallback(
    (text: string, options?: SpeakOptions) => {
      if (!enabled || !isSupported) return;
      const clean = text.trim();
      if (!clean) return;

      if (options?.interrupt ?? true) {
        window.speechSynthesis.cancel();
      }

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = selectedVoice?.lang ?? lang;
      utterance.rate = options?.rate ?? rate;
      utterance.pitch = options?.pitch ?? pitch;
      utterance.volume = volume;
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      window.speechSynthesis.speak(utterance);
    },
    [enabled, isSupported, lang, pitch, rate, selectedVoice, volume]
  );

  useEffect(() => {
    if (!active || !enabled) {
      stop();
    }
  }, [active, enabled, stop]);

  useEffect(() => stop, [stop]);

  return {
    isSupported,
    voices,
    selectedVoiceURI,
    setSelectedVoiceURI,
    speak,
    stop,
  };
}
