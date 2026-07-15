import type { FullConfig } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Sign in once via the Supabase JS client (in node, not the browser) and
// write the @supabase/ssr cookie format straight to a Playwright storage
// state file. This bypasses the sign-in form entirely and avoids a hydration
// race where a pre-hydration click submits via native HTML GET instead of
// React's onSubmit handler.
//
// The persisted file lives at tests/e2e/.auth/curator.json (gitignored).
// Tests in the `curator` project then start each spec already authenticated
// via project-level storageState.
export const STORAGE_STATE_PATH = path.resolve(
  process.cwd(),
  'tests/e2e/.auth/curator.json',
)

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

function projectRefFromUrl(url: string): string {
  const m = url.match(/^https?:\/\/([^.]+)\./)
  if (!m) throw new Error(`Could not derive project ref from SUPABASE_URL: ${url}`)
  return m[1]
}

export default async function globalSetup(_config: FullConfig) {
  loadEnvLocal()
  // Public-only browser checks do not need, and must not require, a real test
  // account. Curator runs keep the authenticated setup as the default.
  if (process.env.PLAYWRIGHT_SKIP_AUTH_SETUP === '1') return

  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!email || !password) {
    throw new Error(
      'TEST_USER_EMAIL and TEST_USER_PASSWORD must be set in .env.local for curator e2e tests.',
    )
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    )
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signInWithPassword failed: ${error.message}`)
  if (!data.session) throw new Error('signInWithPassword returned no session')

  const projectRef = projectRefFromUrl(supabaseUrl)
  const cookieValue =
    'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64')

  const storageState = {
    cookies: [
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        domain: 'localhost',
        path: '/',
        expires: data.session.expires_at ?? -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  }

  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true })
  fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2))
}
