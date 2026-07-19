import {
  DEFAULT_POINTS,
  DEFAULT_TIEBREAKERS,
  type MatchResult,
  type ParticipantId,
  type PointsRules,
  type StandingsRow,
  type Tiebreaker,
} from './types'

export interface StandingsOptions {
  readonly points?: PointsRules
  readonly tiebreakers?: readonly Tiebreaker[]
  /**
   * Whether a walkover's scoreline counts toward game and set differentials.
   *
   * Defaults to false, and that default is deliberate. A walkover score is
   * fictional — the organiser types 6-0 6-0 because the form needs a number, not
   * because anybody played. Letting invented games decide a differential
   * tiebreaker means a pair can be promoted over a rival on the strength of a
   * match that never happened. The win still counts; only the invented games are
   * excluded.
   */
  readonly countWalkoverGames?: boolean
}

interface Tally {
  participantId: ParticipantId
  played: number
  won: number
  drawn: number
  lost: number
  points: number
  setsWon: number
  setsLost: number
  gamesWon: number
  gamesLost: number
}

function emptyTally(participantId: ParticipantId): Tally {
  return {
    participantId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    points: 0,
    setsWon: 0,
    setsLost: 0,
    gamesWon: 0,
    gamesLost: 0,
  }
}

/**
 * Accumulates raw statistics over a set of results.
 *
 * `restrictTo` limits both the participants tallied AND the matches counted, so
 * that passing a tied subset produces a head-to-head mini-league rather than a
 * filtered view of the full table. That distinction is the whole of the
 * head-to-head tiebreaker.
 */
function tally(
  participantIds: readonly ParticipantId[],
  results: readonly MatchResult[],
  options: Required<Pick<StandingsOptions, 'points' | 'countWalkoverGames'>>,
): Map<ParticipantId, Tally> {
  const included = new Set(participantIds)
  const table = new Map<ParticipantId, Tally>()
  for (const id of participantIds) table.set(id, emptyTally(id))

  for (const result of results) {
    const { homeParticipantId: home, awayParticipantId: away } = result
    if (!included.has(home) || !included.has(away)) continue

    const homeTally = table.get(home)
    const awayTally = table.get(away)
    if (!homeTally || !awayTally) continue

    let homeSets = 0
    let awaySets = 0
    let homeGames = 0
    let awayGames = 0

    for (const set of result.sets) {
      homeGames += set.home
      awayGames += set.away
      if (set.home > set.away) homeSets += 1
      else if (set.away > set.home) awaySets += 1
    }

    const isWalkover = result.outcome === 'walkover'
    const countGames = !isWalkover || options.countWalkoverGames

    homeTally.played += 1
    awayTally.played += 1

    if (countGames) {
      homeTally.setsWon += homeSets
      homeTally.setsLost += awaySets
      homeTally.gamesWon += homeGames
      homeTally.gamesLost += awayGames

      awayTally.setsWon += awaySets
      awayTally.setsLost += homeSets
      awayTally.gamesWon += awayGames
      awayTally.gamesLost += homeGames
    }

    if (homeSets > awaySets) {
      homeTally.won += 1
      awayTally.lost += 1
      homeTally.points += isWalkover ? options.points.walkoverWin : options.points.win
      awayTally.points += options.points.loss
    } else if (awaySets > homeSets) {
      awayTally.won += 1
      homeTally.lost += 1
      awayTally.points += isWalkover ? options.points.walkoverWin : options.points.win
      homeTally.points += options.points.loss
    } else {
      homeTally.drawn += 1
      awayTally.drawn += 1
      homeTally.points += options.points.draw
      awayTally.points += options.points.draw
    }
  }

  return table
}

/**
 * The value a tiebreaker compares. Higher is always better, so every criterion
 * can be sorted the same way and adding a new one is a one-line change.
 */
function criterionValue(t: Tally, tiebreaker: Tiebreaker): number {
  switch (tiebreaker) {
    case 'points':
      return t.points
    case 'setDifference':
      return t.setsWon - t.setsLost
    case 'gameDifference':
      return t.gamesWon - t.gamesLost
    case 'gamesWon':
      return t.gamesWon
    case 'wins':
      return t.won
    case 'played':
      // Fewer games played ranks higher — used mid-tournament so a participant
      // is not penalised for a fixture that has not happened yet.
      return -t.played
    case 'headToHead':
      // Never evaluated directly; handled by recursion in rankGroup().
      return 0
  }
}

/**
 * Ranks a set of participants by applying tiebreakers in order.
 *
 * Recursive rather than a flat comparator, because head-to-head is not a
 * pairwise comparison — it is a mini-league among *exactly* the participants
 * still tied at that point. Treating it pairwise is the classic bug: with three
 * pairs tied in a cycle (A beat B, B beat C, C beat A) a pairwise comparator
 * produces an ordering that depends on the sort algorithm's internals, and a
 * different browser can hand out a different trophy.
 *
 * So: group by the current criterion, sort the groups, then recurse into each
 * group that still has more than one member using the remaining criteria.
 */
function rankGroup(
  participantIds: readonly ParticipantId[],
  allResults: readonly MatchResult[],
  tiebreakers: readonly Tiebreaker[],
  options: Required<Pick<StandingsOptions, 'points' | 'countWalkoverGames'>>,
  overall: ReadonlyMap<ParticipantId, Tally>,
): { readonly ids: readonly ParticipantId[]; readonly unresolved: ReadonlySet<ParticipantId> }[] {
  if (participantIds.length <= 1) {
    return [{ ids: participantIds, unresolved: new Set() }]
  }

  const [criterion, ...remaining] = tiebreakers

  if (criterion === undefined) {
    // Every tiebreaker exhausted and still level. Order deterministically so the
    // table is stable across runs, but flag it: the honest resolution is a draw
    // of lots or a play-off, and that is the organiser's call, not ours.
    const ids = [...participantIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    return [{ ids, unresolved: new Set(ids) }]
  }

  // SCOPE IS THE WHOLE POINT HERE.
  //
  // head-to-head is measured over ONLY the matches between the participants
  // still tied — that is what makes it a mini-league. Every other criterion is
  // measured over the FULL set of results, because goal/game difference means
  // difference across the whole group stage, not merely against the rivals you
  // happen to be level with. Restricting those too would silently change what
  // "mejor diferencia de juegos" means.
  const scope =
    criterion === 'headToHead' ? tally(participantIds, allResults, options) : overall

  const buckets = new Map<number, ParticipantId[]>()
  for (const id of participantIds) {
    const t = scope.get(id) ?? emptyTally(id)
    // For head-to-head the ordering value is mini-league points; otherwise it is
    // the criterion measured over the full table.
    const value = criterion === 'headToHead' ? t.points : criterionValue(t, criterion)
    const bucket = buckets.get(value) ?? []
    bucket.push(id)
    buckets.set(value, bucket)
  }

  // A criterion that fails to split the group must not consume a recursion
  // level, or a head-to-head cycle would swallow the remaining tiebreakers.
  if (buckets.size === 1) {
    return rankGroup(participantIds, allResults, remaining, options, overall)
  }

  const orderedValues = [...buckets.keys()].sort((a, b) => b - a)
  const output: { ids: readonly ParticipantId[]; unresolved: ReadonlySet<ParticipantId> }[] = []

  for (const value of orderedValues) {
    const bucket = buckets.get(value) ?? []
    output.push(...rankGroup(bucket, allResults, remaining, options, overall))
  }

  return output
}

/**
 * Computes a final table.
 *
 * Note the standings are never stored — they are derived from results every
 * time. Tiebreakers are the most disputed, most sport-specific logic in the
 * product, and they must have exactly one implementation. A cached copy in the
 * database would drift from this one, and the two would disagree in front of
 * forty people.
 */
export function computeStandings(
  participantIds: readonly ParticipantId[],
  results: readonly MatchResult[],
  options: StandingsOptions = {},
): StandingsRow[] {
  const resolved = {
    points: options.points ?? DEFAULT_POINTS,
    countWalkoverGames: options.countWalkoverGames ?? false,
  }
  const tiebreakers = options.tiebreakers ?? DEFAULT_TIEBREAKERS

  const overall = tally(participantIds, results, resolved)
  const ranked = rankGroup(participantIds, results, tiebreakers, resolved, overall)

  const rows: StandingsRow[] = []
  let position = 0

  for (const group of ranked) {
    for (const id of group.ids) {
      position += 1
      const t = overall.get(id) ?? emptyTally(id)
      rows.push({
        participantId: id,
        played: t.played,
        won: t.won,
        drawn: t.drawn,
        lost: t.lost,
        points: t.points,
        setsWon: t.setsWon,
        setsLost: t.setsLost,
        setDifference: t.setsWon - t.setsLost,
        gamesWon: t.gamesWon,
        gamesLost: t.gamesLost,
        gameDifference: t.gamesWon - t.gamesLost,
        position,
        unresolvedTie: group.unresolved.has(id),
      })
    }
  }

  return rows
}

/** Convenience: the ids that finished in the top `count` places. */
export function topN(standings: readonly StandingsRow[], count: number): ParticipantId[] {
  return standings.slice(0, count).map((row) => row.participantId)
}
