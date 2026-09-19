// Server-side Supabase clients (Next.js App Router).
//
// Requires (in .env.local):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY   (server-only; NEVER expose to the browser)
//
// Install deps:  pnpm add @supabase/supabase-js @supabase/ssr

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Request-scoped client that reads the signed-in user's session from cookies.
 * Use for verifying who is calling (RLS-enforced).
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // called from a Server Component; safe to ignore (middleware refreshes)
        }
      },
    },
  });
}

/**
 * Validate a bearer access token and return the user, or null.
 * Used by the token service when clients send `Authorization: Bearer <jwt>`
 * (the mobile app sends this; the web app can use cookies instead).
 */
export async function getUserFromBearer(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

/**
 * Service-role client: bypasses RLS. Server-only. Use for reading plan/usage
 * and writing usage rows. NEVER import this into client code.
 */
export function createServiceSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
