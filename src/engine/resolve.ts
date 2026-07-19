import type { GeneratedMatch, MatchId, ParticipantId, Slot } from './types'

/**
 * The result of a decided match.
 *
 * `home`/`away` record who occupied each side, not just who won. That is needed
 * to evaluate conditional matches — "was this won by the away side?" — and it is
 * what the UI needs to render a completed match in the original orientation
 * rather than winner-first.
 *
 * `loser` is null when the match was a bye: nobody lost.
 */
export interface MatchOutcome {
  readonly home: ParticipantId | null
  readonly away: ParticipantId | null
  readonly winner: ParticipantId | null
  readonly loser: ParticipantId | null
}

export type OutcomeMap = ReadonlyMap<MatchId, MatchOutcome>

/**
 * Resolves a slot to a concrete participant, or null if not yet known.
 *
 * This is what turns "Ganador C1" into "García / Ruiz" the instant a result is
 * entered. Called for every slot on every bracket paint, so it stays a pure
 * lookup with no recursion into unresolved matches.
 */
export function resolveSlot(slot: Slot, outcomes: OutcomeMap): ParticipantId | null {
  switch (slot.kind) {
    case 'participant':
      return slot.participantId
    case 'bye':
      return null
    case 'winnerOf':
      return outcomes.get(slot.matchId)?.winner ?? null
    case 'loserOf':
      return outcomes.get(slot.matchId)?.loser ?? null
    case 'groupPosition':
      // Resolved from standings, not from a single match. The caller supplies
      // these via the group stage's qualifier seeding.
      return null
  }
}

/**
 * A type guard, not a plain boolean — callers immediately reach for
 * `slot.matchId`, and without narrowing that is a compile error.
 */
function isDerived(slot: Slot): slot is Extract<Slot, { kind: 'winnerOf' | 'loserOf' }> {
  return slot.kind === 'winnerOf' || slot.kind === 'loserOf'
}

/**
 * Whether a conditional match is actually played.
 *
 * Unconditional matches always are. The double-elimination grand final decider
 * is played only when the referenced match was won by its `away` side — meaning
 * the losers-bracket entrant won and the winners-bracket finalist still has just
 * one defeat.
 *
 * Returns false while the referenced match is undecided, so a bracket in
 * progress does not advertise the decider as upcoming before it is known to be
 * needed.
 */
export function isMatchPlayed(match: GeneratedMatch, outcomes: OutcomeMap): boolean {
  const condition = match.condition
  if (!condition) return true

  const referenced = outcomes.get(condition.matchId)
  if (!referenced || referenced.winner === null) return false

  return referenced.away !== null && referenced.winner === referenced.away
}

/**
 * Orders matches so every match comes after the ones it depends on.
 *
 * A bracket is a DAG and slots reference matches by id, so resolution must
 * follow topological order. Sorting by round is not enough: losers-bracket
 * matches reference winners-bracket matches from higher round numbers than
 * their own, so a round sort resolves them in the wrong order and silently
 * yields empty slots.
 */
export function orderForResolution(matches: readonly GeneratedMatch[]): GeneratedMatch[] {
  const byId = new Map(matches.map((m) => [m.id, m]))
  const visited = new Set<MatchId>()
  const visiting = new Set<MatchId>()
  const result: GeneratedMatch[] = []

  const visit = (match: GeneratedMatch): void => {
    if (visited.has(match.id)) return
    if (visiting.has(match.id)) {
      // A cycle is a generator bug, not bad input. Fail loudly rather than
      // producing a half-resolved bracket that looks plausible.
      throw new Error(`Cyclic dependency in bracket at match "${match.id}"`)
    }
    visiting.add(match.id)

    const dependencies: MatchId[] = []
    for (const slot of [match.home, match.away]) {
      if (isDerived(slot)) dependencies.push(slot.matchId)
    }
    if (match.condition) dependencies.push(match.condition.matchId)

    for (const id of dependencies) {
      const dependency = byId.get(id)
      if (dependency) visit(dependency)
    }

    visiting.delete(match.id)
    visited.add(match.id)
    result.push(match)
  }

  // Stable input order keeps output deterministic among equal-depth matches.
  for (const match of matches) visit(match)

  return result
}

function decideOutcome(
  match: GeneratedMatch,
  outcomes: OutcomeMap,
  decide?: (home: ParticipantId, away: ParticipantId, match: GeneratedMatch) => ParticipantId,
): MatchOutcome | null {
  const home = resolveSlot(match.home, outcomes)
  const away = resolveSlot(match.away, outcomes)

  const homeAbsent = match.home.kind === 'bye' || (isDerived(match.home) && home === null)
  const awayAbsent = match.away.kind === 'bye' || (isDerived(match.away) && away === null)

  if (home !== null && away !== null) {
    if (!decide) return null
    const winner = decide(home, away, match)
    return { home, away, winner, loser: winner === home ? away : home }
  }

  // One side absent: the other advances without playing. Nobody loses.
  if (home !== null && awayAbsent) return { home, away: null, winner: home, loser: null }
  if (away !== null && homeAbsent) return { home: null, away, winner: away, loser: null }
  if (homeAbsent && awayAbsent) return { home: null, away: null, winner: null, loser: null }

  return null
}

/**
 * Advances byes automatically through a bracket.
 *
 * A participant drawn against a bye has won without playing, and their next
 * match should show their name rather than "Ganador C1". Running this at
 * generation time means the published draw sheet is correct before anyone
 * arrives at the club.
 */
export function propagateByes(matches: readonly GeneratedMatch[]): Map<MatchId, MatchOutcome> {
  const outcomes = new Map<MatchId, MatchOutcome>()

  for (const match of orderForResolution(matches)) {
    if (!isMatchPlayed(match, outcomes)) continue
    const outcome = decideOutcome(match, outcomes)
    if (outcome) outcomes.set(match.id, outcome)
  }

  return outcomes
}

/**
 * Plays a whole bracket through with a caller-supplied decision function.
 *
 * Used by the tests to verify structural properties (does the top seed win a
 * bracket where the better seed always wins?), and available to the UI for
 * "what happens if…" projections.
 */
export function simulateBracket(
  matches: readonly GeneratedMatch[],
  decide: (home: ParticipantId, away: ParticipantId, match: GeneratedMatch) => ParticipantId,
): Map<MatchId, MatchOutcome> {
  const outcomes = new Map<MatchId, MatchOutcome>()

  for (const match of orderForResolution(matches)) {
    if (!isMatchPlayed(match, outcomes)) continue
    const outcome = decideOutcome(match, outcomes, decide)
    if (outcome) outcomes.set(match.id, outcome)
  }

  return outcomes
}

/**
 * Counts how many times each participant lost.
 *
 * The invariant that defines double elimination is that nobody is eliminated
 * before their second defeat. Counting losses tests that directly, which is far
 * more convincing than asserting on the bracket's shape.
 */
export function countLosses(outcomes: OutcomeMap): Map<ParticipantId, number> {
  const losses = new Map<ParticipantId, number>()
  for (const { loser } of outcomes.values()) {
    if (loser === null) continue
    losses.set(loser, (losses.get(loser) ?? 0) + 1)
  }
  return losses
}

/**
 * The champion, accounting for a grand final decider that may not have been
 * played. Returns null while the bracket is unfinished.
 */
export function bracketChampion(
  matches: readonly GeneratedMatch[],
  outcomes: OutcomeMap,
): ParticipantId | null {
  const ordered = orderForResolution(matches)

  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const match = ordered[i]
    if (!match) continue
    if (!isMatchPlayed(match, outcomes)) continue
    // Third-place matches are played last on the day but do not decide the title.
    if (match.side === 'thirdPlace') continue
    const winner = outcomes.get(match.id)?.winner
    if (winner) return winner
  }

  return null
}
