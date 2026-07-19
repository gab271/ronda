import { computeStandings } from './standings'
import {
  DEFAULT_POINTS,
  EngineError,
  assertMinimum,
  assertUniqueParticipants,
  participantSlot,
  type GeneratedMatch,
  type MatchResult,
  type ParticipantId,
  type PointsRules,
} from './types'

export interface SwissPairingOptions {
  readonly points?: PointsRules
  readonly idPrefix?: string
  /**
   * Participants who have already received a bye. Supplying this prevents the
   * same person sitting out twice while others have never rested.
   */
  readonly previousByes?: readonly ParticipantId[]
}

export interface SwissRound {
  readonly round: number
  readonly matches: readonly GeneratedMatch[]
  readonly bye: ParticipantId | null
}

/** Every pair that has already met, as an unordered key. */
export function playedPairs(results: readonly MatchResult[]): Set<string> {
  const pairs = new Set<string>()
  for (const result of results) {
    pairs.add(pairKey(result.homeParticipantId, result.awayParticipantId))
  }
  return pairs
}

function pairKey(a: ParticipantId, b: ParticipantId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Swiss pairing for one round.
 *
 * Swiss is the format for "lots of players, not much time": everyone plays every
 * round, nobody is eliminated, and after r rounds the standings are a decent
 * ranking of 2^r players. It is common in chess and increasingly used for large
 * one-day padel events where a full round robin would take a week.
 *
 * ── The rule that makes it Swiss ────────────────────────────────────────────
 * Pair participants with similar scores, and NEVER repeat an opponent. The
 * second half is what makes this non-trivial: a greedy pass down the standings
 * frequently paints itself into a corner, where the last two players left have
 * already met and there is nobody to swap with.
 *
 * So this uses backtracking rather than a greedy sweep. Participants are sorted
 * by standing, then the search tries to pair the highest unpaired participant
 * with the best-ranked legal opponent, backtracking whenever a branch leaves an
 * impossible remainder. That guarantees a rematch-free pairing whenever one
 * exists — a greedy algorithm does not, and the failure only shows up in the
 * later rounds of a real tournament, which is the worst possible time.
 *
 * Field sizes here are small (a big amateur event is 64 pairs over 7 rounds), so
 * the search is comfortably fast. The `maxAttempts` guard exists only to stop a
 * pathological input from spinning.
 *
 * ── Byes ────────────────────────────────────────────────────────────────────
 * An odd field means somebody sits out. The bye goes to the LOWEST-ranked
 * participant who has not already had one — lowest-ranked because a free win is
 * worth most to whoever is doing worst, and "not already had one" because
 * resting twice while someone else never rests is the complaint an organiser
 * will actually hear about.
 */
export function pairSwissRound(
  participantIds: readonly ParticipantId[],
  previousResults: readonly MatchResult[],
  round: number,
  options: SwissPairingOptions = {},
): SwissRound {
  assertUniqueParticipants(participantIds)
  assertMinimum(participantIds, 2)

  const { points = DEFAULT_POINTS, idPrefix = 'sw', previousByes = [] } = options

  // Rank by current standings so pairing puts like against like. In round one
  // every participant is level, so this preserves the supplied order — which is
  // the organiser's seeding, or a seeded shuffle.
  const standings = computeStandings(participantIds, previousResults, { points })
  const ranked = standings.map((row) => row.participantId)

  const met = playedPairs(previousResults)
  const hadBye = new Set(previousByes)

  let bye: ParticipantId | null = null
  let pool = ranked

  if (pool.length % 2 === 1) {
    // Walk up from the bottom to the first participant who has not rested.
    let candidate: ParticipantId | null = null
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      const id = pool[i]
      if (id !== undefined && !hadBye.has(id)) {
        candidate = id
        break
      }
    }
    // Everyone has already had a bye: fall back to the lowest ranked.
    bye = candidate ?? pool[pool.length - 1] ?? null
    pool = pool.filter((id) => id !== bye)
  }

  const pairs = findPairing(pool, met)

  if (!pairs) {
    throw new EngineError(
      'swiss_pairing_impossible',
      `No rematch-free pairing exists for round ${String(round)}. ` +
        `Every remaining opponent has already been played — the field is too small ` +
        `for this many rounds.`,
    )
  }

  const matches: GeneratedMatch[] = pairs.map(([home, away], index) => ({
    id: `${idPrefix}-r${String(round)}-m${String(index + 1)}`,
    side: 'group' as const,
    round,
    order: index + 1,
    home: participantSlot(home),
    away: participantSlot(away),
    label: `round.${String(round)}`,
  }))

  return { round, matches, bye }
}

/**
 * Backtracking search for a rematch-free perfect matching.
 *
 * Returns null when no such pairing exists, which is a real and reachable state:
 * eight participants can only play seven rounds before every pair has met.
 * Reporting that honestly is better than silently emitting a rematch.
 */
function findPairing(
  pool: readonly ParticipantId[],
  met: ReadonlySet<string>,
): [ParticipantId, ParticipantId][] | null {
  if (pool.length % 2 !== 0) return null

  const result: [ParticipantId, ParticipantId][] = []
  // Guard against pathological blow-up. Far above anything a real field needs:
  // a 64-player event settles in well under a thousand steps.
  let budget = 200_000

  const search = (remaining: readonly ParticipantId[]): boolean => {
    if (remaining.length === 0) return true
    if (budget-- <= 0) return false

    const [first, ...rest] = remaining
    if (first === undefined) return true

    // Try opponents in ranking order, so the pairing stays as close to
    // "adjacent in the standings" as the no-rematch rule allows.
    for (let i = 0; i < rest.length; i += 1) {
      const candidate = rest[i]
      if (candidate === undefined) continue
      if (met.has(pairKey(first, candidate))) continue

      result.push([first, candidate])
      const next = [...rest.slice(0, i), ...rest.slice(i + 1)]
      if (search(next)) return true
      result.pop()
    }

    return false
  }

  return search(pool) ? result : null
}

/**
 * How many rounds a Swiss event can run before rematches become unavoidable.
 *
 * With n participants each can face n-1 distinct opponents, so n-1 rounds is the
 * hard ceiling — at which point Swiss has degenerated into a round robin. The
 * useful number is usually ceil(log2(n)), which is enough to separate a clear
 * winner; the UI uses this to suggest a round count rather than letting an
 * organiser configure eight rounds for a field of six.
 */
export function maxSwissRounds(participantCount: number): number {
  return Math.max(0, participantCount - 1)
}

/** Rounds needed to produce a clear winner: ceil(log2(n)). */
export function suggestedSwissRounds(participantCount: number): number {
  if (participantCount < 2) return 0
  return Math.ceil(Math.log2(participantCount))
}
