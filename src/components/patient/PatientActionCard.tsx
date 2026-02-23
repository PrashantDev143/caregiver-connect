import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PatientActionCardProps {
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
  variant?: 'medication' | 'games';
  className?: string;
}

export function PatientActionCard({
  to,
  title,
  description,
  icon: Icon,
  variant = 'medication',
  className,
}: PatientActionCardProps) {
  const isMedication = variant === 'medication';

  return (
    <Link
      to={to}
      className={cn(
        'patient-action-card soft-ripple group relative block overflow-hidden rounded-3xl border p-6 shadow-[0_16px_32px_-22px_rgba(15,23,42,0.65)] transition-all duration-300',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        isMedication
          ? 'border-cyan-300/40 bg-[linear-gradient(140deg,hsl(196_100%_95%),hsl(152_80%_93%))] text-slate-900'
          : 'border-violet-300/35 bg-[linear-gradient(140deg,hsl(264_85%_96%),hsl(190_90%_94%))] text-slate-900',
        !isMedication && 'patient-games-card',
        className
      )}
      aria-label={title}
    >
      <div
        className={cn(
          'pointer-events-none absolute -top-14 right-4 h-28 w-28 rounded-full blur-2xl transition-transform duration-300 group-hover:scale-110',
          isMedication ? 'bg-cyan-200/60' : 'bg-violet-200/60'
        )}
      />
      <div className="relative z-[1] flex min-h-[170px] flex-col justify-between gap-6">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/80 shadow-sm',
              isMedication ? 'patient-attention-pulse' : 'patient-games-icon patient-icon-bob'
            )}
          >
            <Icon className={cn('h-8 w-8', isMedication ? 'text-cyan-700' : 'text-violet-700')} />
          </div>
          <div>
            <h3 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{title}</h3>
            <p className="mt-2 text-base text-slate-700 sm:text-lg">{description}</p>
          </div>
        </div>
        <div className="inline-flex items-center text-sm font-semibold text-slate-700 transition-transform duration-300 group-hover:translate-x-1">
          Open
          <ArrowRight className="ml-2 h-4 w-4" />
        </div>
      </div>
    </Link>
  );
}
