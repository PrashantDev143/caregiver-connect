import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ResponsiveGameImageProps {
  src: string;
  alt: string;
  className?: string;
  imageClassName?: string;
  fit?: 'cover' | 'contain';
}

export function ResponsiveGameImage({
  src,
  alt,
  className,
  imageClassName,
  fit = 'cover',
}: ResponsiveGameImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-slate-100', className)}>
      {!loaded && !failed && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-slate-200 to-slate-100" />
      )}

      {failed ? (
        <div className="flex h-full min-h-[9rem] w-full items-center justify-center bg-slate-100 text-slate-500">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ImageOff className="h-4 w-4" />
            Image unavailable
          </div>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            setLoaded(true);
          }}
          className={cn(
            'h-full w-full transition-opacity duration-300',
            fit === 'cover' ? 'object-cover' : 'object-contain',
            loaded ? 'opacity-100' : 'opacity-0',
            imageClassName
          )}
        />
      )}
    </div>
  );
}
