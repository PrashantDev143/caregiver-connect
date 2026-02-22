import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Brain,
  Circle as CircleIcon,
  Eye,
  Palette,
  Puzzle,
  RotateCcw,
  Sparkles,
  Square,
  Star,
  Triangle,
  Trophy,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CelebrationOverlay } from '@/components/ui/celebration-overlay';
import { ResponsiveGameImage } from '@/components/games/ResponsiveGameImage';
import { useAlertVoice } from '@/hooks/useAlertVoice';

type QuickGameType = 'color' | 'shape' | 'puzzle' | 'object';

interface BrainGamesSectionProps {
  className?: string;
}

interface ColorChoice {
  id: string;
  label: string;
  buttonClass: string;
}

interface ShapeChoice {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface PuzzleQuestion {
  id: string;
  prompt: string;
  options: string[];
  answer: string;
}

interface ObjectQuestion {
  id: string;
  image: string;
  alt: string;
  options: string[];
  answer: string;
}

const colorChoices: ColorChoice[] = [
  { id: 'sky', label: 'Sky Blue', buttonClass: 'bg-sky-400 hover:bg-sky-500' },
  { id: 'mint', label: 'Mint Green', buttonClass: 'bg-emerald-400 hover:bg-emerald-500' },
  { id: 'sun', label: 'Warm Yellow', buttonClass: 'bg-amber-300 hover:bg-amber-400' },
  { id: 'rose', label: 'Soft Rose', buttonClass: 'bg-rose-300 hover:bg-rose-400' },
];

const shapeChoices: ShapeChoice[] = [
  { id: 'circle', label: 'Circle', icon: CircleIcon },
  { id: 'square', label: 'Square', icon: Square },
  { id: 'triangle', label: 'Triangle', icon: Triangle },
  { id: 'star', label: 'Star', icon: Star },
];

const puzzleQuestions: PuzzleQuestion[] = [
  { id: 'p1', prompt: '2, 4, 6, ?', options: ['8', '10', '12'], answer: '8' },
  { id: 'p2', prompt: 'A, C, E, ?', options: ['F', 'G', 'H'], answer: 'G' },
  { id: 'p3', prompt: 'Sun, Moon, Sun, ?', options: ['Moon', 'Star', 'Cloud'], answer: 'Moon' },
];

const objectQuestions: ObjectQuestion[] = [
  {
    id: 'o1',
    image: '/images/objects/microwave-square.jpg',
    alt: 'Microwave on a counter',
    options: ['Microwave', 'Toaster', 'Kettle'],
    answer: 'Microwave',
  },
  {
    id: 'o2',
    image: '/images/objects/blender.jpg',
    alt: 'Blender appliance',
    options: ['Mixer', 'Blender', 'Kettle'],
    answer: 'Blender',
  },
  {
    id: 'o3',
    image: '/images/objects/toaster.webp',
    alt: 'Toaster appliance',
    options: ['Oven', 'Toaster', 'Microwave'],
    answer: 'Toaster',
  },
];

const gameTypeCards = [
  {
    id: 'memory',
    title: 'Memory Card Matching',
    description: 'Match familiar faces, places, and objects with guided cues.',
    icon: Brain,
    tooltip: 'Best for recall and recognition practice.',
  },
  {
    id: 'shape',
    title: 'Shape Recognition',
    description: 'Identify simple shapes with large clear buttons.',
    icon: Square,
    tooltip: 'Good for visual focus and pattern recognition.',
  },
  {
    id: 'color',
    title: 'Color Matching',
    description: 'Pick the matching color target from calm palettes.',
    icon: Palette,
    tooltip: 'Supports attention and quick decision making.',
  },
  {
    id: 'puzzle',
    title: 'Simple Puzzles',
    description: 'Complete gentle pattern sequences with one tap.',
    icon: Puzzle,
    tooltip: 'Encourages problem-solving without pressure.',
  },
  {
    id: 'object',
    title: 'Object Recognition',
    description: 'Recognize everyday items from clear photos.',
    icon: Eye,
    tooltip: 'Builds practical recognition skills.',
  },
] as const;

const getRandomIndex = (length: number, excluding?: number) => {
  if (length <= 1) return 0;
  let next = Math.floor(Math.random() * length);
  if (excluding === undefined) return next;
  while (next === excluding) {
    next = Math.floor(Math.random() * length);
  }
  return next;
};

export function BrainGamesSection({ className }: BrainGamesSectionProps) {
  const [activeQuickGame, setActiveQuickGame] = useState<QuickGameType>('color');
  const [colorTargetIndex, setColorTargetIndex] = useState(() => getRandomIndex(colorChoices.length));
  const [shapeTargetIndex, setShapeTargetIndex] = useState(() => getRandomIndex(shapeChoices.length));
  const [puzzleIndex, setPuzzleIndex] = useState(() => getRandomIndex(puzzleQuestions.length));
  const [objectIndex, setObjectIndex] = useState(() => getRandomIndex(objectQuestions.length));
  const [score, setScore] = useState(0);
  const [scoreBumpToken, setScoreBumpToken] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('Pick any mini game and take your time.');
  const [showCelebrate, setShowCelebrate] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [hintRequested, setHintRequested] = useState(false);
  const [revealAnswerRequested, setRevealAnswerRequested] = useState(false);
  const [lastSelection, setLastSelection] = useState<string | null>(null);
  const [flashColorHint, setFlashColorHint] = useState(false);
  const { playAlert } = useAlertVoice();

  useEffect(() => {
    if (scoreBumpToken === null) return;
    const timer = window.setTimeout(() => setScoreBumpToken(null), 800);
    return () => window.clearTimeout(timer);
  }, [scoreBumpToken]);

  useEffect(() => {
    if (failedAttempts >= 3) {
      setHintRequested(true);
    }
  }, [failedAttempts]);

  const currentColor = colorChoices[colorTargetIndex];
  const currentShape = shapeChoices[shapeTargetIndex];
  const currentPuzzle = puzzleQuestions[puzzleIndex];
  const currentObject = objectQuestions[objectIndex];
  const showHint = hintRequested || failedAttempts >= 3;
  const hasHintSignal = showHint || failedAttempts > 0;
  const TargetShapeIcon = currentShape.icon;

  const quickGameTitle = useMemo(() => {
    if (activeQuickGame === 'shape') return 'Shape Recognition';
    if (activeQuickGame === 'puzzle') return 'Simple Puzzle';
    if (activeQuickGame === 'object') return 'Object Recognition';
    return 'Color Matching';
  }, [activeQuickGame]);

  const answerLabel = useMemo(() => {
    if (activeQuickGame === 'color') return currentColor.label;
    if (activeQuickGame === 'shape') return currentShape.label;
    if (activeQuickGame === 'puzzle') return currentPuzzle.answer;
    return currentObject.answer;
  }, [activeQuickGame, currentColor.label, currentObject.answer, currentPuzzle.answer, currentShape.label]);

  const minimalHint = useMemo(() => {
    if (activeQuickGame === 'shape') return 'Hint: look for the shape button with the soft glowing outline.';
    if (activeQuickGame === 'color') return 'Hint: watch for a brief flash in the target color.';
    if (activeQuickGame === 'puzzle') return `Hint: the answer starts with "${currentPuzzle.answer.charAt(0)}".`;
    return 'Hint: the object image will gently zoom.';
  }, [activeQuickGame, currentPuzzle.answer]);

  const resetChallenge = () => {
    setFailedAttempts(0);
    setHintRequested(false);
    setRevealAnswerRequested(false);
    setLastSelection(null);
  };

  const celebrate = (message: string) => {
    setScore((prev) => prev + 10);
    setScoreBumpToken(Date.now());
    setFeedback(message);
    setShowCelebrate(true);
    void playAlert('correct', { cooldownMs: 0 });
    resetChallenge();
    window.setTimeout(() => setShowCelebrate(false), 900);
  };

  const handleIncorrect = (message: string, selected: string) => {
    setFeedback(message);
    setLastSelection(selected);
    setFailedAttempts((prev) => prev + 1);
    void playAlert('incorrect', { cooldownMs: 0 });
    if (activeQuickGame === 'color') {
      setFlashColorHint(true);
      window.setTimeout(() => setFlashColorHint(false), 650);
    }
  };

  const resetAll = () => {
    setIsResetting(true);
    window.setTimeout(() => {
      setColorTargetIndex(getRandomIndex(colorChoices.length));
      setShapeTargetIndex(getRandomIndex(shapeChoices.length));
      setPuzzleIndex(getRandomIndex(puzzleQuestions.length));
      setObjectIndex(getRandomIndex(objectQuestions.length));
      setFeedback('Fresh start. You are ready.');
      resetChallenge();
      setIsResetting(false);
    }, 220);
  };

  useEffect(() => {
    resetChallenge();
  }, [activeQuickGame]);

  return (
    <Card className={`relative overflow-hidden border-primary/20 shadow-sm transition-all duration-300 hover:border-primary/35 hover:shadow-lg ${className ?? ''}`}>
      <CelebrationOverlay
        active={showCelebrate}
        message="Excellent!"
        submessage="Great brain workout."
        particleCount={20}
      />

      <CardHeader className="bg-gradient-to-r from-cyan-500/10 via-background to-emerald-500/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            Brain Games
            <Badge className="ml-1 border-emerald-300/50 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
              Alzheimer-friendly
            </Badge>
          </CardTitle>
        </div>
        <CardDescription>
          Gentle, positive mini activities designed for focus, recall, and confidence.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {gameTypeCards.map((item) => {
            const Icon = item.icon;
            const isMemory = item.id === 'memory';
            const isActive = !isMemory && activeQuickGame === item.id;

            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isMemory) setActiveQuickGame(item.id as QuickGameType);
                    }}
                    className={`rounded-2xl border p-3 text-left transition-all duration-200 ${
                      isActive
                        ? 'border-primary/60 bg-primary/10 shadow-sm'
                        : 'border-border bg-background hover:-translate-y-0.5 hover:shadow-sm'
                    }`}
                  >
                    <Icon className={`mb-2 h-5 w-5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                    {isMemory && (
                      <Badge variant="outline" className="mt-2 border-cyan-300 text-cyan-700">
                        Full Game
                      </Badge>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">{item.tooltip}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className={`relative rounded-2xl border border-primary/20 bg-primary/5 p-4 transition-opacity duration-200 ${isResetting ? 'opacity-50' : 'opacity-100'}`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{quickGameTitle}</p>
            <div className="relative flex items-center gap-2 rounded-full border border-primary/25 bg-background px-3 py-1.5">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-primary">Score: {score}</span>
              {scoreBumpToken && (
                <span key={scoreBumpToken} className="score-bump absolute -right-2 -top-2 text-xs font-bold text-emerald-700">
                  +10
                </span>
              )}
            </div>
          </div>

          {activeQuickGame === 'color' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Match this target color:</p>
              <div
                className={`h-12 w-full max-w-xs rounded-xl border border-primary/30 ${currentColor.buttonClass} ${
                  showHint && flashColorHint ? 'animate-pulse ring-2 ring-cyan-400/60' : ''
                }`}
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {colorChoices.map((choice, index) => {
                  const isIncorrectPick = lastSelection === choice.id && !isResetting && choice.id !== currentColor.id;
                  return (
                    <Button
                      key={choice.id}
                      type="button"
                      onClick={() => {
                        if (index === colorTargetIndex) {
                          celebrate('Wonderful color match.');
                          setColorTargetIndex((prev) => getRandomIndex(colorChoices.length, prev));
                          return;
                        }
                        handleIncorrect('Nice try. Use the target swatch as your clue.', choice.id);
                      }}
                      className={`h-14 rounded-xl text-sm font-semibold text-slate-900 ${choice.buttonClass} ${
                        isIncorrectPick ? 'border-2 border-rose-500/70' : ''
                      }`}
                    >
                      {choice.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {activeQuickGame === 'shape' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Choose the matching shape:</p>
              <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-primary/25 bg-background">
                {TargetShapeIcon ? <TargetShapeIcon className="h-8 w-8 text-primary" /> : null}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {shapeChoices.map((shape, index) => {
                  const Icon = shape.icon;
                  const isIncorrectPick = lastSelection === shape.id && shape.id !== currentShape.id;
                  const hintGlow = hasHintSignal && shape.id === currentShape.id;
                  return (
                    <Button
                      key={shape.id}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (index === shapeTargetIndex) {
                          celebrate('Great shape recognition.');
                          setShapeTargetIndex((prev) => getRandomIndex(shapeChoices.length, prev));
                          return;
                        }
                        handleIncorrect('Good effort. Follow the highlighted outline.', shape.id);
                      }}
                      className={`h-14 rounded-xl border-primary/20 bg-white text-foreground hover:bg-primary/5 ${
                        isIncorrectPick ? 'border-rose-500/70 bg-rose-50' : ''
                      } ${
                        hintGlow ? 'border-cyan-500/70 shadow-[0_0_0_2px_rgba(6,182,212,0.18)]' : ''
                      }`}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      {shape.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {activeQuickGame === 'puzzle' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Pick the best answer:</p>
              <p className="text-lg font-bold text-foreground">{currentPuzzle.prompt}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {currentPuzzle.options.map((option) => {
                  const isIncorrectPick = lastSelection === option && option !== currentPuzzle.answer;
                  return (
                    <Button
                      key={option}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (option === currentPuzzle.answer) {
                          celebrate('Puzzle solved nicely.');
                          setPuzzleIndex((prev) => getRandomIndex(puzzleQuestions.length, prev));
                          return;
                        }
                        handleIncorrect('Close one. Use the clue and try again.', option);
                      }}
                      className={`h-14 rounded-xl text-base ${
                        isIncorrectPick ? 'border-rose-500/70 bg-rose-50' : ''
                      }`}
                    >
                      {option}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {activeQuickGame === 'object' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Identify the object shown:</p>
              <div className="h-40 w-full max-w-sm">
                <ResponsiveGameImage
                  src={currentObject.image}
                  alt={currentObject.alt}
                  fit="contain"
                  className="h-full w-full rounded-2xl border border-primary/20 bg-white p-2"
                  imageClassName={`transition-transform duration-300 ${
                    hasHintSignal ? 'scale-[1.05]' : 'scale-100'
                  }`}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {currentObject.options.map((option) => {
                  const isIncorrectPick = lastSelection === option && option !== currentObject.answer;
                  return (
                    <Button
                      key={option}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (option === currentObject.answer) {
                          celebrate('Excellent object recognition.');
                          setObjectIndex((prev) => getRandomIndex(objectQuestions.length, prev));
                          return;
                        }
                        handleIncorrect('Great attempt. Watch the image hint and try again.', option);
                      }}
                      className={`h-14 rounded-xl text-base ${
                        isIncorrectPick ? 'border-rose-500/70 bg-rose-50' : ''
                      }`}
                    >
                      {option}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="mt-4 text-sm font-medium text-emerald-800">{feedback}</p>

          {(showHint || (activeQuickGame === 'puzzle' && failedAttempts > 0)) ? (
            <p className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
              {revealAnswerRequested ? `Answer: ${answerLabel}` : minimalHint}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {!hintRequested ? (
              <Button type="button" variant="outline" onClick={() => setHintRequested(true)}>
                Show Hint
              </Button>
            ) : null}
            {showHint && !revealAnswerRequested ? (
              <Button type="button" variant="outline" onClick={() => setRevealAnswerRequested(true)}>
                Reveal Answer
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={resetAll}
            className="h-11 rounded-xl border-primary/30 bg-white px-5 transition-all duration-200 hover:-translate-y-0.5"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Play Again
          </Button>
          <Button
            asChild
            className="h-11 rounded-xl px-5 text-base font-semibold transition-all duration-200 hover:-translate-y-0.5"
          >
            <Link to="/patient/game">
              Start Full Memory Game
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
