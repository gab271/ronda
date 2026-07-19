/**
 * The ONLY module in the codebase that reads `import.meta.env`.
 *
 * Two reasons this chokepoint is worth the indirection:
 *
 * 1. Milestone 4 moves the public tournament page to a Cloudflare Worker, where
 *    configuration arrives as `env` bindings rather than `import.meta.env`.
 *    Porting then means rewriting this file and nothing else.
 * 2. Tests can supply configuration without stubbing Vite globals.
 *
 * ── On the anon key being public ────────────────────────────────────────────
 * `VITE_SUPABASE_ANON_KEY` ships to every browser that loads the app. This is
 * correct and by design: the anon key identifies the project, it does not
 * authorise anything. All access control lives in Row Level Security policies in
 * the database (see supabase/migrations/).
 *
 * Do not "fix" this by hiding the key — there is nothing to hide, and moving it
 * server-side would break the public tournament page, which must work with no
 * account at all.
 *
 * What must NEVER appear in a VITE_ variable: the service_role key, the Postgres
 * connection string, SMTP credentials, or any payment provider secret. Those
 * bypass RLS entirely. scripts/check-no-secrets.mjs fails the build if one
 * reaches dist/.
 */

export interface AppConfig {
  readonly supabaseUrl: string
  readonly supabaseAnonKey: string
}

function readRequired(key: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string {
  // Indexing ImportMetaEnv yields `any`, so it is narrowed explicitly here
  // rather than trusted — this is the one place the whole app reads config, so
  // it is worth being pedantic about.
  const value: unknown = import.meta.env[key]

  if (typeof value !== 'string' || value.length === 0) {
    // Deliberately loud and specific. The alternative failure mode is a blank
    // page and a 401 from PostgREST, which tells a developer nothing.
    throw new Error(
      `Missing ${key}. Copy .env.example to .env.local and fill in the values ` +
        `from your Supabase project (Project Settings → Data API). ` +
        `See README.md § Setup.`,
    )
  }

  return value
}

function parseConfig(): AppConfig {
  const supabaseUrl = readRequired('VITE_SUPABASE_URL')
  const supabaseAnonKey = readRequired('VITE_SUPABASE_ANON_KEY')

  // Validate the URL shape at startup rather than letting a typo surface as an
  // opaque network failure on the public page later.
  try {
    void new URL(supabaseUrl)
  } catch {
    throw new Error(
      `VITE_SUPABASE_URL is not a valid URL: "${supabaseUrl}". ` +
        `It should look like https://<project-ref>.supabase.co`,
    )
  }

  if (supabaseAnonKey.startsWith('sb_secret') || supabaseAnonKey.includes('service_role')) {
    throw new Error(
      'VITE_SUPABASE_ANON_KEY appears to hold a service-role/secret key. ' +
        'That key bypasses Row Level Security and must never reach the browser. ' +
        'Use the publishable anon key instead.',
    )
  }

  return { supabaseUrl, supabaseAnonKey }
}

export const config: AppConfig = parseConfig()
