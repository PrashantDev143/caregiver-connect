const managedAudioNodes = new Set<HTMLAudioElement>();

export const registerManagedAudio = (audio: HTMLAudioElement) => {
  managedAudioNodes.add(audio);
};

export const unregisterManagedAudio = (audio: HTMLAudioElement) => {
  managedAudioNodes.delete(audio);
};

export const stopAllAudioPlayback = () => {
  managedAudioNodes.forEach((audio) => {
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      audio.onerror = null;
    } catch {
      // Best effort stop.
    }
  });
  managedAudioNodes.clear();

  if (typeof document !== 'undefined') {
    document.querySelectorAll('audio').forEach((audio) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // Best effort stop.
      }
    });
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
};
