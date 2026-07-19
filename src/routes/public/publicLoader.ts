import type { LoaderFunctionArgs } from 'react-router-dom'
import { getPublicTournament, type PublicTournament } from '~/data/public/getPublicTournament'
import { PublicFetchError } from '~/data/public/publicClient'

export interface PublicLoaderData {
  readonly tournament: PublicTournament | null
  readonly errorKind: PublicFetchError['kind'] | null
}

/**
 * Loader for the public tournament page.
 *
 * ── The hydration seam ──────────────────────────────────────────────────────
 * The `window.__RONDA_DATA__` check is the whole reason this is written now
 * rather than in milestone 4. When the public page moves to edge rendering, the
 * Cloudflare Function will inline the tournament JSON into the HTML it returns;
 * this loader will find it already present and skip the network entirely. The
 * client-side diff at that point is zero lines — the seam only works if it is
 * declared before the thing that uses it.
 *
 * ── Why errors are returned, not thrown ─────────────────────────────────────
 * Throwing routes to an errorElement, which loses the page chrome and renders a
 * generic failure. For the storefront we want a designed, on-brand, translated
 * message with a retry — so the loader returns a discriminated result and the
 * component decides. A player on bad 4G at a club sees "check your connection",
 * not a stack trace.
 */
export async function publicLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<PublicLoaderData> {
  const slug = params['slug']

  if (!slug) {
    return { tournament: null, errorKind: 'not-found' }
  }

  const inlined = typeof window !== 'undefined' ? window.__RONDA_DATA__ : undefined
  if (inlined && inlined.publicSlug === slug) {
    return { tournament: inlined, errorKind: null }
  }

  try {
    const tournament = await getPublicTournament(slug, { signal: request.signal })
    return { tournament, errorKind: null }
  } catch (error) {
    if (error instanceof PublicFetchError) {
      return { tournament: null, errorKind: error.kind }
    }
    // An aborted request is React Router cancelling a superseded navigation.
    // Re-throw so it is not rendered as a failure to the user.
    throw error
  }
}
