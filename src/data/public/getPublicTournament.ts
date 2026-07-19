/**
 * The public tournament read. One call, one round trip, one cacheable URL.
 *
 * Shape note: these types describe what `get_public_tournament` returns, which
 * is intentionally NARROWER than the underlying tables. Participant contact
 * details, organiser identity and internal configuration are not in this
 * document and cannot be requested — the database function decides the shape,
 * not the client. That is the point of routing anonymous reads through an RPC.
 */

import { callPublicRpc, PublicFetchError, type PublicClientOptions } from './publicClient'

export type TournamentStatus = 'published' | 'in_progress' | 'finished'
export type MatchStatus = 'pending' | 'live' | 'finished' | 'walkover' | 'bye' | 'cancelled'
export type Sport = 'padel' | 'futbol7' | 'baloncesto' | 'ajedrez'

export interface PublicParticipant {
  readonly id: string
  readonly displayName: string
  readonly seed: number | null
  readonly groupId: string | null
  readonly withdrawn: boolean
}

export interface PublicMatch {
  readonly id: string
  readonly roundId: string | null
  readonly stageId: string | null
  readonly homeParticipantId: string | null
  readonly awayParticipantId: string | null
  /** Placeholder label when the participant is not yet known ("Ganador C1"). */
  readonly homeLabel: string | null
  readonly awayLabel: string | null
  readonly courtId: string | null
  readonly scheduledAt: string | null
  readonly status: MatchStatus
  /** Per-set scores, e.g. [{ h: 6, a: 4 }, { h: 7, a: 5 }]. */
  readonly score: readonly { readonly h: number; readonly a: number }[] | null
  readonly winnerParticipantId: string | null
}

export interface PublicCourt {
  readonly id: string
  readonly name: string
  readonly sortOrder: number
}

export interface PublicTournament {
  readonly id: string
  readonly name: string
  readonly sport: Sport
  readonly format: string
  readonly status: TournamentStatus
  readonly publicSlug: string
  readonly timezone: string
  readonly startsOn: string | null
  readonly endsOn: string | null
  readonly clubName: string | null
  readonly branding: Readonly<Record<string, string>> | null
  readonly participants: readonly PublicParticipant[]
  readonly courts: readonly PublicCourt[]
  readonly matches: readonly PublicMatch[]
}

/**
 * Milestone 4 renders this page at the edge and inlines the payload into the
 * HTML. When that happens the loader finds the data already present and skips
 * the fetch entirely — so the client-side change at that point is zero lines.
 * Declaring the seam now is what makes that true.
 */
declare global {
  interface Window {
    __CUADRO_DATA__?: PublicTournament
  }
}

export async function getPublicTournament(
  slug: string,
  options: PublicClientOptions = {},
): Promise<PublicTournament> {
  const result = await callPublicRpc<PublicTournament | null>(
    'get_public_tournament',
    { p_slug: slug },
    options,
  )

  // The function returns SQL NULL for an unknown or unpublished slug. Both are
  // deliberately indistinguishable from the outside: revealing that a draft
  // exists at a given slug would make unpublished tournaments enumerable.
  if (result === null) {
    throw new PublicFetchError(`No published tournament for slug "${slug}"`, 404, 'not-found')
  }

  return result
}
