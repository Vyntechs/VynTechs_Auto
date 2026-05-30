import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function getServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Components cannot set cookies; safe to ignore.
          }
        },
      },
    },
  )
}

/**
 * The signed-in user, or null — never throws.
 *
 * Public pages (landing, privacy, terms, sign-up) call this only to choose
 * cosmetic state (which CTA to show). A stale or invalid auth cookie makes
 * Supabase's getUser() throw ("Invalid Refresh Token"), which would 500 the
 * whole page. Cosmetic state must soft-fail to signed-out, never crash.
 */
export async function getOptionalUser(): Promise<User | null> {
  try {
    const supabase = await getServerSupabase()
    const { data } = await supabase.auth.getUser()
    return data.user ?? null
  } catch {
    return null
  }
}
