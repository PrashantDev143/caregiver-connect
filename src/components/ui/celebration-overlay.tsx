import { useMemo, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface CelebrationOverlayProps {
  active: boolean;
  message?: string;
  submessage?: string;
  fullscreen?: boolean;
  className?: string;
  particleCount?: number;
}

const PARTICLE_COLORS = [
  '#22c55e',
  '#06b6d4',
  '#38bdf8',
  '#f59e0b',
  '#fb7185',
  '#a78bfa',
];

export function CelebrationOverlay({
  active,
  message,
  submessage,
  fullscreen = false,
  className,
  particleCount = 28,
}: CelebrationOverlayProps) {
  const particles = useMemo(
    () =>
      Array.from({ length: particleCount }, (_, index) => {
        const angle = (Math.PI * 2 * index) / particleCount + (Math.random() - 0.5) * 0.35;
        const distance = 80 + Math.random() * 240;
        return {
          id: `${index}-${Date.now()}`,
          color: PARTICLE_COLORS[index % PARTICLE_COLORS.length],
          size: 6 + Math.random() * 10,
          delay: Math.random() * 180,
          duration: 900 + Math.random() * 850,
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance,
        };
      }),
    [particleCount, active]
  );

  if (!active) return null;

  return (
    <div
      className={cn(
        'pointer-events-none z-50',
        fullscreen ? 'fixed inset-0' : 'absolute inset-0',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          'relative flex h-full w-full items-center justify-center overflow-hidden',
          fullscreen ? 'bg-slate-950/30 backdrop-blur-[2px]' : ''
        )}
      >
        <div className="celebration-ping absolute h-16 w-16 rounded-full bg-white/80" />
        {particles.map((particle) => (
          <span
            key={particle.id}
            className="celebration-particle absolute rounded-sm"
            style={
              {
                width: `${particle.size}px`,
                height: `${particle.size * 0.72}px`,
                backgroundColor: particle.color,
                animationDelay: `${particle.delay}ms`,
                animationDuration: `${particle.duration}ms`,
                '--dx': `${particle.dx}px`,
                '--dy': `${particle.dy}px`,
              } as CSSProperties
            }
          />
        ))}
        {(message || submessage) && (
          <div className="celebration-pop mx-4 max-w-xl rounded-2xl border border-white/60 bg-white/90 px-6 py-5 text-center shadow-2xl">
            {message && <p className="text-2xl font-bold text-slate-800">{message}</p>}
            {submessage && <p className="mt-2 text-sm text-slate-600">{submessage}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
