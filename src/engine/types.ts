/**
 * Core domain types for the scheduling engine.
 *
 * These deliberately do NOT mirror the database schema. The engine takes plain
 * ids and returns plain structures; persisting them is the caller's problem.
 * That separation is what lets these functions be tested exhaustively without a
 * database, and what keeps `src/engine` importable from a Worker later.
 *
 * No enums anywhere — `erasableSyntaxOnly` bans them, and `as const` unions give
 * better inference at zero runtime cost.
 */

export type ParticipantId = string
export type MatchId = string

/**
 * Who occupies one side of a match.
 *
 * A bracket match's participants are frequently not known when the fixture is
 * generated — the semi-final exists before anyone has qualified for it. Rather
 * than leaving those matches out until they resolve (which would mean the
 * public draw sheet cannot show the shape of the bracket), a slot can reference
 * the match it derives from. The UI renders that as "Ganador C1".
 */
export type Slot =
  | { readonly kind: 'participant'; readonly participantId: ParticipantId }
  /** No opponent. The other side advances without playing. */
  | { readonly kind: 'bye' }
  | { readonly kind: 'winnerOf'; readonly matchId: MatchId }
  | { readonly kind: 'loserOf'; readonly matchId: MatchId }
  /** Nth place of a group, resolved when the group stage finishes. */
  | { readonly kind: 'groupPosition'; readonly group: string; readonly position: number }

export const participantSlot = (participantId: ParticipantId): Slot => ({
  kind: 'participant',
  participantId,
})

export const byeSlot = (): Slot => ({ kind: 'bye' })

export const winnerOf = (matchId: MatchId): Slot => ({ kind: 'winnerOf', matchId })

export const loserOf = (matchId: MatchId): Slot => ({ kind: 'loserOf', matchId })

export const groupPosition = (group: string, position: number): Slot => ({
  kind: 'groupPosition',
  group,
  position,
})

/** Which half of the draw a match belongs to. */
export type BracketSide = 'winners' | 'losers' | 'grandFinal' | 'group' | 'main' | 'thirdPlace'

/**
 * A match that is only played in some outcomes.
 *
 * The only current case is the double-elimination grand final decider: it is
 * played solely when the losers-bracket entrant wins the first grand final,
 * because the winners-bracket finalist has not yet lost twice. Printed brackets
 * label this "si es necesario" / "if necessary".
 *
 * Modelling it as a condition rather than generating the match on demand keeps
 * the published bracket a fixed shape. A bracket that grows a new match
 * mid-tournament is confusing on a wall display and breaks any id already
 * handed out to a scorekeeper.
 */
export interface MatchCondition {
  /** Play only if the referenced match was won by its `away` side. */
  readonly kind: 'ifAwayWon'
  readonly matchId: MatchId
}

/**
 * A generated fixture. `id` is deterministic and structural (e.g. "w-r2-m1"),
 * never random — regenerating a draw from the same seed must produce byte-identical
 * ids, or a re-generation would orphan every result already entered against them.
 */
export interface GeneratedMatch {
  readonly id: MatchId
  readonly side: BracketSide
  /** 1-based round number within its side. */
  readonly round: number
  /** 1-based position within the round, for stable display ordering. */
  readonly order: number
  readonly home: Slot
  readonly away: Slot
  /** Group label, when this match belongs to a group stage. */
  readonly group?: string
  /** Human-facing round name key, resolved through i18n by the UI. */
  readonly label?: string
  /** Present when the match is only played in some outcomes. */
  readonly condition?: MatchCondition
}

export interface Fixture {
  readonly matches: readonly GeneratedMatch[]
  /** Rounds per side, so the UI can lay out a bracket without recomputing. */
  readonly rounds: readonly FixtureRound[]
  /** Participants that received a bye, by round. */
  readonly byes: readonly { readonly round: number; readonly participantId: ParticipantId }[]
}

export interface FixtureRound {
  readonly side: BracketSide
  readonly round: number
  readonly matchIds: readonly MatchId[]
  readonly label: string
}

/** A completed result, fed back in to compute standings. */
export interface MatchResult {
  readonly matchId: MatchId
  readonly homeParticipantId: ParticipantId
  readonly awayParticipantId: ParticipantId
  /** Per-set (padel/tennis) or per-period scores. One entry for simple sports. */
  readonly sets: readonly { readonly home: number; readonly away: number }[]
  /** 'walkover' awards the win without games counting toward differentials. */
  readonly outcome?: 'played' | 'walkover' | 'retired'
}

export interface StandingsRow {
  readonly participantId: ParticipantId
  readonly played: number
  readonly won: number
  readonly drawn: number
  readonly lost: number
  readonly points: number
  readonly setsWon: number
  readonly setsLost: number
  readonly setDifference: number
  readonly gamesWon: number
  readonly gamesLost: number
  readonly gameDifference: number
  /** 1-based final position after all tiebreakers. */
  readonly position: number
  /**
   * True when every configured tiebreaker was exhausted and this participant is
   * still level with a neighbour. The position shown is then a deterministic
   * fallback, not a sporting result.
   *
   * Surfaced rather than hidden because the honest resolution is a coin toss or
   * a play-off decided by the organiser, and silently ordering by internal id
   * would let a trophy be handed out on the basis of a database sort.
   */
  readonly unresolvedTie: boolean
}

/**
 * Points awarded per outcome. Defaults suit padel (win/loss only); football 7
 * uses 3/1/0.
 */
export interface PointsRules {
  readonly win: number
  readonly draw: number
  readonly loss: number
  /** Some leagues award a point for losing in a deciding set. */
  readonly walkoverWin: number
}

export const DEFAULT_POINTS: PointsRules = {
  win: 3,
  draw: 1,
  loss: 0,
  walkoverWin: 3,
}

/**
 * Ordered tiebreakers, applied in sequence until one separates the tied group.
 *
 * `headToHead` is applied only among the participants still tied at that point —
 * that is what makes it a *mini-league* rather than a pairwise comparison, and
 * getting it wrong is the most common source of disputed final tables.
 */
export type Tiebreaker =
  | 'points'
  | 'headToHead'
  | 'setDifference'
  | 'gameDifference'
  | 'gamesWon'
  | 'wins'
  | 'played'

export const DEFAULT_TIEBREAKERS: readonly Tiebreaker[] = [
  'points',
  'headToHead',
  'setDifference',
  'gameDifference',
  'gamesWon',
]

/** Thrown for inputs the caller could have prevented. */
export class EngineError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'EngineError'
    this.code = code
  }
}

/** Rejects duplicate ids early — a duplicate silently corrupts every format. */
export function assertUniqueParticipants(participantIds: readonly ParticipantId[]): void {
  const seen = new Set<ParticipantId>()
  for (const id of participantIds) {
    if (seen.has(id)) {
      throw new EngineError('duplicate_participant', `Participant "${id}" appears more than once.`)
    }
    seen.add(id)
  }
}

export function assertMinimum(participantIds: readonly ParticipantId[], minimum: number): void {
  if (participantIds.length < minimum) {
    throw new EngineError(
      'too_few_participants',
      `Need at least ${String(minimum)} participants, got ${String(participantIds.length)}.`,
    )
  }
}
