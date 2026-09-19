// Browser-side Supabase client (Next.js App Router).
// Install deps:  pnpm add @supabase/supabase-js @supabase/ssr
'use client';

import { createBrowserClient } from '@supabase/ssr';

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
