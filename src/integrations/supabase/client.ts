// Supabase client – uses env only (no hardcoded keys).
// Compare URL and anon key prefix with: Supabase Dashboard → Settings → API.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const normalizeEnvValue = (value: string | undefined) => {
  if (!value) return '';
  const trimmed = value.trim();
  return trimmed.replace(/^['"]|['"]$/g, '');
};

const SUPABASE_URL = normalizeEnvValue(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const SUPABASE_ANON_KEY = normalizeEnvValue(
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
);

// Runtime verification: log so you can compare with Dashboard → Settings → API
if (typeof window !== 'undefined') {
  const urlOk = SUPABASE_URL.startsWith('https://') && SUPABASE_URL.includes('.supabase.co');
  const keyPrefix = SUPABASE_ANON_KEY ? `${SUPABASE_ANON_KEY.slice(0, 30)}...` : '(missing)';
  console.log('[Supabase] URL:', SUPABASE_URL || '(missing)');
  console.log('[Supabase] Anon key prefix:', keyPrefix);
  if (!urlOk || !SUPABASE_ANON_KEY) {
    console.error(
      '[Supabase] Invalid config. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) in .env and match Dashboard → Settings → API.'
    );
  }
}

export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);
