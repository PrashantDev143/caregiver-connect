export type GameContentType = "FAMILY_RECALL" | "PLACE_MATCH" | "OBJECT_IDENTIFY";

export type RoundOption = {
  id: string;
  label: string;
  imageUrl: string;
};

export type GameRound = {
  id: string;
  contentType: GameContentType;
  prompt: string;
  calmingTip: string;
  audioUrl?: string;
  options: [RoundOption, RoundOption, RoundOption, RoundOption];
  answerOptionId: string;
  successMessage: string;
  retryMessage: string;
};

export const GAME_ROUNDS: GameRound[] = [
  {
    id: "family-voice-daughter",
    contentType: "FAMILY_RECALL",
    prompt: "Listen to the voice fully, then choose the family member speaking.",
    calmingTip: "No rush. You can replay the voice before answering.",
    audioUrl: "/audio/people/daughter-voice.mp3",
    options: [
      { id: "daughter", label: "Daughter", imageUrl: "/images/people/daughter.jpg" },
      { id: "son", label: "Son", imageUrl: "/images/people/son.jpg" },
      { id: "nurse", label: "Nurse", imageUrl: "/images/people/nurse.jpg" },
      { id: "friend", label: "Friend", imageUrl: "/images/people/friend.jpg" },
    ],
    answerOptionId: "daughter",
    successMessage: "Great recall. That voice is your daughter.",
    retryMessage: "Good effort. Listen once more and choose calmly.",
  },
  {
    id: "place-match-temple",
    contentType: "PLACE_MATCH",
    prompt: "Listen to the place clue, then select the place.",
    calmingTip: "Take a breath, hear the clue, then look at each place one by one.",
    audioUrl: "/audio/places/temple_recording.mp3",
    options: [
      { id: "temple", label: "Temple", imageUrl: "/images/places/temple.jpg" },
      { id: "park", label: "Park", imageUrl: "/images/places/park.jpg" },
      { id: "beach", label: "Beach", imageUrl: "/images/places/beach.jpg" },
      { id: "market", label: "Market", imageUrl: "/images/places/market.jpg" },
    ],
    answerOptionId: "temple",
    successMessage: "Well done. You matched the place correctly.",
    retryMessage: "Nice attempt. Review each place and try again.",
  },
  {
    id: "object-identify-microwave",
    contentType: "OBJECT_IDENTIFY",
    prompt: "Listen and identify the object from the options.",
    calmingTip: "Take your time. You can try again in the next round.",
    options: [
      { id: "microwave", label: "Microwave", imageUrl: "/images/objects/microwave-square.jpg" },
      { id: "toaster", label: "Toaster", imageUrl: "/images/objects/toaster.webp" },
      { id: "kettle", label: "Kettle", imageUrl: "/images/objects/kettle.avif" },
      { id: "blender", label: "Blender", imageUrl: "/images/objects/blender.jpg" },
    ],
    answerOptionId: "microwave",
    successMessage: "Excellent. You picked the correct object.",
    retryMessage: "Good try. Take another look and try again.",
  },
];

export const GAME_TYPE_MEMORY = "memory_game";

export function calculateGameScore(correctAnswers: number, totalRounds: number): number {
  if (totalRounds <= 0) return 0;
  return Math.round((correctAnswers / totalRounds) * 100);
}
