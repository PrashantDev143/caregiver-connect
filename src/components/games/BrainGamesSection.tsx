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
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CelebrationOverlay } from '@/components/ui/celebration-overlay';
import { ResponsiveGameImage } from '@/components/games/ResponsiveGameImage';
import { useVoiceAssistant } from '@/hooks/useVoiceAssistant';

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
    description: 'Match familiar faces, places, and objects with voice cues.',
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
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  useEffect(() => {
    if (scoreBumpToken === null) return;
    const timer = window.setTimeout(() => setScoreBumpToken(null), 800);
    return () => window.clearTimeout(timer);
  }, [scoreBumpToken]);

  const { speak, isSupported: voiceSupported } = useVoiceAssistant({
    enabled: voiceEnabled,
    rate: 0.97,
    pitch: 1,
  });

  const currentColor = colorChoices[colorTargetIndex];
  const currentShape = shapeChoices[shapeTargetIndex];
  const currentPuzzle = puzzleQuestions[puzzleIndex];
  const currentObject = objectQuestions[objectIndex];

  const quickGameTitle = useMemo(() => {
    if (activeQuickGame === 'shape') return 'Shape Recognition';
    if (activeQuickGame === 'puzzle') return 'Simple Puzzle';
    if (activeQuickGame === 'object') return 'Object Recognition';
    return 'Color Matching';
  }, [activeQuickGame]);

  const celebrate = (message: string) => {
    setScore((prev) => prev + 10);
    setScoreBumpToken(Date.now());
    setFeedback(message);
    speak(`${message} Great job.`, { interrupt: true });
    setShowCelebrate(true);
    window.setTimeout(() => setShowCelebrate(false), 900);
  };

  const resetAll = () => {
    setIsResetting(true);
    window.setTimeout(() => {
      setColorTargetIndex(getRandomIndex(colorChoices.length));
      setShapeTargetIndex(getRandomIndex(shapeChoices.length));
      setPuzzleIndex(getRandomIndex(puzzleQuestions.length));
      setObjectIndex(getRandomIndex(objectQuestions.length));
      setFeedback('Fresh start. You are ready.');
      speak('Fresh start ready. Pick any mini game and continue at your pace.', { interrupt: true });
      setIsResetting(false);
    }, 220);
  };

  useEffect(() => {
    if (activeQuickGame === 'color') {
      speak(`Color matching. Please tap ${currentColor.label}.`, { interrupt: true, rate: 0.95 });
      return;
    }
    if (activeQuickGame === 'shape') {
      speak(`Shape recognition. Please choose ${currentShape.label}.`, { interrupt: true, rate: 0.95 });
      return;
    }
    if (activeQuickGame === 'puzzle') {
      speak(`Simple puzzle. ${currentPuzzle.prompt}`, { interrupt: true, rate: 0.95 });
      return;
    }
    speak('Object recognition. Look at the image and select the correct object.', { interrupt: true, rate: 0.95 });
  }, [activeQuickGame, currentColor.label, currentPuzzle.prompt, currentShape.label, speak]);

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
          {voiceSupported ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVoiceEnabled((prev) => !prev)}
              className="h-8 rounded-full px-3"
            >
              {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              {voiceEnabled ? 'Voice on' : 'Voice off'}
            </Button>
          ) : null}
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
              <p className="text-sm text-muted-foreground">Tap the matching color:</p>
              <p className="text-lg font-bold text-foreground">{currentColor.label}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {colorChoices.map((choice, index) => (
                  <Button
                    key={choice.id}
                    type="button"
                    onClick={() => {
                      if (index === colorTargetIndex) {
                        celebrate('Wonderful color match.');
                        setColorTargetIndex((prev) => getRandomIndex(colorChoices.length, prev));
                      } else {
                        setFeedback('Nice try. You are doing well.');
                        speak('Nice try. You are doing well.', { interrupt: true, rate: 0.95 });
                      }
                    }}
                    className={`h-14 rounded-xl text-sm font-semibold text-slate-900 ${choice.buttonClass}`}
                  >
                    {choice.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {activeQuickGame === 'shape' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Choose the shape shown:</p>
              <p className="text-lg font-bold text-foreground">{currentShape.label}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {shapeChoices.map((shape, index) => {
                  const Icon = shape.icon;
                  return (
                    <Button
                      key={shape.id}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (index === shapeTargetIndex) {
                          celebrate('Great shape recognition.');
                          setShapeTargetIndex((prev) => getRandomIndex(shapeChoices.length, prev));
                        } else {
                          setFeedback('Good effort. Try the next one.');
                          speak('Good effort. Try the next one.', { interrupt: true, rate: 0.95 });
                        }
                      }}
                      className="h-14 rounded-xl border-primary/20 bg-white text-foreground hover:bg-primary/5"
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
                {currentPuzzle.options.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (option === currentPuzzle.answer) {
                        celebrate('Puzzle solved nicely.');
                        setPuzzleIndex((prev) => getRandomIndex(puzzleQuestions.length, prev));
                      } else {
                        setFeedback('Close one. You can do this.');
                        speak('Close one. You can do this.', { interrupt: true, rate: 0.95 });
                      }
                    }}
                    className="h-14 rounded-xl text-base"
                  >
                    {option}
                  </Button>
                ))}
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
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {currentObject.options.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (option === currentObject.answer) {
                        celebrate('Excellent object recognition.');
                        setObjectIndex((prev) => getRandomIndex(objectQuestions.length, prev));
                      } else {
                        setFeedback('Great attempt. Let us try again.');
                        speak('Great attempt. Let us try again.', { interrupt: true, rate: 0.95 });
                      }
                    }}
                    className="h-14 rounded-xl text-base"
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <p className="mt-4 text-sm font-medium text-emerald-800">{feedback}</p>
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
