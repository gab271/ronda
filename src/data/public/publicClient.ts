/**
 * PUBLIC READ PATH — deliberately does not use @supabase/supabase-js.
 *
 * This file is small on purpose. It is a plain `fetch` wrapper against a single
 * PostgREST RPC endpoint, and that choice is architectural rather than
 * stylistic. Three reasons, in order of importance:
 *
 * 1. CORRECTNESS. supabase-js attaches the signed-in user's JWT to every
 *    request. If the public tournament page used it, an organiser previewing
 *    their own link would have RLS evaluated as `authenticated` and could see a
 *    page that players never see — including, potentially, an unpublished
 *    tournament. Sending no Authorization token beyond the anon key means the
 *    page renders identically for everyone, always. That bug is invisible in
 *    development (where you are always logged in) and would surface at a real
 *    tournament.
 *
 * 2. PORTABILITY. This runs unmodified inside a Cloudflare Worker — no Node
 *    shims, no polyfills, no browser globals. Milestone 4 renders the public
 *    page at the edge, and this file is that milestone's data layer already.
 *    Hence `fetchImpl` is a parameter: the Worker passes its own fetch.
 *
 * 3. SIZE. supabase-js pulls in GoTrue, realtime, storage and postgrest — around
 *    40KB gzip — for a page that needs one GET. This is ~1KB. The public page is
 *    the storefront, seen by 20–60 people per tournament on outdoor 4G.
 *
 * The ESLint config enforces (1) and (3) mechanically: importing @supabase/* or
 * any auth module from src/data/public/ or src/routes/public/ is an error.
 */

import { config } from '~/lib/env'

/** Thrown for any non-2xx response or transport failure on the public path. */
export class PublicFetchError extends Error {
  readonly status: number
  readonly kind: 'not-found' | 'offline' | 'server' | 'unknown'

  constructor(message: string, status: number, kind: PublicFetchError['kind']) {
    super(message)
    this.name = 'PublicFetchError'
    this.status = status
    this.kind = kind
  }
}

export interface PublicClientOptions {
  /** Injected so the same function runs in a Worker, and so tests need no mocks. */
  readonly fetchImpl?: typeof fetch
  readonly signal?: AbortSignal
  readonly supabaseUrl?: string
  readonly supabaseAnonKey?: string
}

/**
 * Calls a Postgres function exposed through PostgREST as an anonymous caller.
 *
 * Why an RPC rather than table queries: the public page needs a tournament plus
 * its participants, matches and courts. As PostgREST table reads that is four
 * round trips, and on a 300ms-RTT connection four sequential round trips is over
 * a second of dead time. One RPC returning a single JSON document is one round
 * trip, and — because it is one cacheable URL — it is also what makes edge
 * caching trivial in milestone 4.
 *
 * The security half of the argument is in supabase/migrations/0001_init.sql:
 * the function is SECURITY DEFINER and shapes its own output, so participant
 * emails and phone numbers cannot leak. With table-level anon SELECT policies we
 * would be one `select *` away from publishing players' phone numbers.
 */
export async function callPublicRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  options: PublicClientOptions = {},
): Promise<T> {
  const {
    fetchImpl = globalThis.fetch,
    signal,
    supabaseUrl = config.supabaseUrl,
    supabaseAnonKey = config.supabaseAnonKey,
  } = options

  const url = `${supabaseUrl}/rest/v1/rpc/${fn}`

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        // The anon key, and ONLY the anon key. Never a user session token —
        // see reason (1) in the file header.
        Authorization: `Bearer ${supabaseAnonKey}`,
        Accept: 'application/json',
      },
      body: JSON.stringify(args),
      ...(signal ? { signal } : {}),
    })
  } catch (cause) {
    // A thrown fetch is a transport failure: no network, DNS failure, or the
    // request was aborted. Distinguished from an HTTP error because the user
    // advice differs — "check your connection" vs "this tournament is gone".
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new PublicFetchError('Network request failed', 0, 'offline')
  }

  if (!response.ok) {
    throw new PublicFetchError(
      `Public RPC ${fn} failed with ${String(response.status)}`,
      response.status,
      response.status >= 500 ? 'server' : 'unknown',
    )
  }

  return (await response.json()) as T
}
