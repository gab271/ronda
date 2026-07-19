/**
 * ORGANISER PATH ONLY.
 *
 * This is the authenticated client: sessions, token refresh, writes. The public
 * tournament page must never import it — see src/data/public/publicClient.ts for
 * why, and eslint.config.js for the rule that enforces it.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from '~/lib/env'
import type { Database } from './database.types'

export type RondaClient = SupabaseClient<Database>

/**
 * Vite's HMR re-executes modules while keeping the old ones alive. Without this
 * cache, every hot update constructs another GoTrue client against the same
 * storage key, and they race each other refreshing the same token — which
 * presents as random sign-outs during development and is very hard to attribute.
 */
const globalRef = globalThis as typeof globalThis & {
  __rondaSupabase__?: RondaClient
}

function createRondaClient(): RondaClient {
  return createClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Needed so the email-confirmation and password-reset links, which arrive
      // as URL fragments, are consumed on load.
      detectSessionInUrl: true,
      // PKCE rather than the implicit flow: the code never lands in the URL
      // fragment where it can leak through history or a Referer header.
      flowType: 'pkce',
      storageKey: 'ronda.auth',
    },
    global: {
      headers: { 'x-application-name': 'ronda' },
    },
  })
}

export const supabase: RondaClient = globalRef.__rondaSupabase__ ?? createRondaClient()

if (import.meta.hot) {
  globalRef.__rondaSupabase__ = supabase
}
