import { bracketSize, knockoutRoundLabel, seedOrder } from './seeding'
import {
  assertMinimum,
  assertUniqueParticipants,
  byeSlot,
  loserOf,
  participantSlot,
  winnerOf,
  type Fixture,
  type FixtureRound,
  type GeneratedMatch,
  type MatchId,
  type ParticipantId,
  type Slot,
} from './types'

export interface DoubleEliminationOptions {
  /**
   * If the losers-bracket winner beats the winners-bracket winner in the grand
   * final, play a decider. Without it the tournament is not truly double
   * elimination — the winners-bracket finalist would be eliminated on a single
   * defeat, which is the whole thing the format exists to prevent.
   */
  readonly grandFinalReset?: boolean
  readonly idPrefix?: string
}

/**
 * Double elimination: you are out after two defeats, not one.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 * For a bracket of 2^k:
 *
 *   Winners bracket : k rounds, 2^(k-r) matches in round r
 *   Losers bracket  : 2(k-1) rounds, alternating between two kinds
 *   Grand final     : winners-bracket winner vs losers-bracket winner
 *
 * The losers bracket alternates because of arithmetic, not aesthetics. Round 1
 * of the winners bracket produces 2^(k-1) losers — enough to pair among
 * themselves. Round 2 produces only 2^(k-2), which is exactly the number of
 * survivors from the previous losers round, so those two sets play each other.
 * That alternation continues all the way down:
 *
 *   LB odd rounds  (1, 3, 5…) : survivors play survivors    ["consolidation"]
 *   LB even rounds (2, 4, 6…) : survivors meet fresh WB losers  ["drop-in"]
 *
 * ── Why drop-ins are reversed ───────────────────────────────────────────────
 * When winners-bracket losers drop in, they are matched in REVERSE order
 * against the losers-bracket survivors. Without that reversal, a participant
 * knocked out of the winners bracket frequently meets the very same opponent
 * again immediately, which feels arbitrary to players and wastes a round. The
 * reversal pushes rematches as late as possible. This is standard practice in
 * published double-elimination brackets and is the detail most naive
 * implementations omit.
 *
 * ── Total matches ───────────────────────────────────────────────────────────
 * 2n-2 for a full bracket of n (every participant but the champion loses twice,
 * and the champion may lose once), plus one if the grand final resets.
 */
export function generateDoubleElimination(
  participantIds: readonly ParticipantId[],
  options: DoubleEliminationOptions = {},
): Fixture {
  assertUniqueParticipants(participantIds)
  // Below four, double elimination degenerates: with two participants it is just
  // a best-of-three, and with three the losers bracket is mostly byes. Say so
  // rather than emitting a confusing bracket.
  assertMinimum(participantIds, 4)

  const { grandFinalReset = true, idPrefix = 'de' } = options

  const size = bracketSize(participantIds.length)
  const k = Math.log2(size)
  const order = seedOrder(size)

  const matches: GeneratedMatch[] = []
  const rounds: FixtureRound[] = []
  const byes: { round: number; participantId: ParticipantId }[] = []

  const slots: Slot[] = order.map((seed) => {
    const participant = participantIds[seed - 1]
    return participant === undefined ? byeSlot() : participantSlot(participant)
  })

  // ── Winners bracket ──────────────────────────────────────────────────────
  const wbRoundIds: MatchId[][] = []

  for (let round = 1; round <= k; round += 1) {
    const count = size / 2 ** round
    const roundIds: MatchId[] = []

    for (let i = 0; i < count; i += 1) {
      const id = `${idPrefix}-w-r${String(round)}-m${String(i + 1)}`
      let home: Slot
      let away: Slot

      if (round === 1) {
        home = slots[i * 2] ?? byeSlot()
        away = slots[i * 2 + 1] ?? byeSlot()

        if (home.kind === 'bye' && away.kind === 'participant') {
          byes.push({ round: 1, participantId: away.participantId })
        } else if (away.kind === 'bye' && home.kind === 'participant') {
          byes.push({ round: 1, participantId: home.participantId })
        }
      } else {
        const previous = wbRoundIds[round - 2] ?? []
        const feedA = previous[i * 2]
        const feedB = previous[i * 2 + 1]
        if (feedA === undefined || feedB === undefined) continue
        home = winnerOf(feedA)
        away = winnerOf(feedB)
      }

      matches.push({
        id,
        side: 'winners',
        round,
        order: i + 1,
        home,
        away,
        label: round === k ? 'round.winnersFinal' : knockoutRoundLabel(count),
      })
      roundIds.push(id)
    }

    wbRoundIds.push(roundIds)
    rounds.push({
      side: 'winners',
      round,
      matchIds: roundIds,
      label: round === k ? 'round.winnersFinal' : knockoutRoundLabel(count),
    })
  }

  // ── Losers bracket ───────────────────────────────────────────────────────
  const lbRoundIds: MatchId[][] = []
  const totalLbRounds = 2 * (k - 1)

  for (let lbRound = 1; lbRound <= totalLbRounds; lbRound += 1) {
    // j identifies which pass through the alternation we are on.
    const j = Math.ceil(lbRound / 2)
    const count = 2 ** (k - 1 - j)
    const isDropIn = lbRound % 2 === 0
    const roundIds: MatchId[] = []

    for (let i = 0; i < count; i += 1) {
      const id = `${idPrefix}-l-r${String(lbRound)}-m${String(i + 1)}`
      let home: Slot
      let away: Slot

      if (lbRound === 1) {
        // Pair the winners-bracket first-round losers among themselves.
        const wb1 = wbRoundIds[0] ?? []
        const feedA = wb1[i * 2]
        const feedB = wb1[i * 2 + 1]
        if (feedA === undefined || feedB === undefined) continue
        home = loserOf(feedA)
        away = loserOf(feedB)
      } else if (isDropIn) {
        // Survivors meet losers dropping from winners-bracket round j+1,
        // taken in reverse order to delay rematches (see the header comment).
        const previous = lbRoundIds[lbRound - 2] ?? []
        const dropping = [...(wbRoundIds[j] ?? [])].reverse()
        const feedA = previous[i]
        const feedB = dropping[i]
        if (feedA === undefined || feedB === undefined) continue
        home = winnerOf(feedA)
        away = loserOf(feedB)
      } else {
        // Consolidation: survivors play each other.
        const previous = lbRoundIds[lbRound - 2] ?? []
        const feedA = previous[i * 2]
        const feedB = previous[i * 2 + 1]
        if (feedA === undefined || feedB === undefined) continue
        home = winnerOf(feedA)
        away = winnerOf(feedB)
      }

      matches.push({
        id,
        side: 'losers',
        round: lbRound,
        order: i + 1,
        home,
        away,
        label: lbRound === totalLbRounds ? 'round.losersFinal' : `round.losers${String(lbRound)}`,
      })
      roundIds.push(id)
    }

    lbRoundIds.push(roundIds)
    rounds.push({
      side: 'losers',
      round: lbRound,
      matchIds: roundIds,
      label: lbRound === totalLbRounds ? 'round.losersFinal' : `round.losers${String(lbRound)}`,
    })
  }

  // ── Grand final ──────────────────────────────────────────────────────────
  const wbFinal = wbRoundIds[k - 1]?.[0]
  const lbFinal = lbRoundIds[totalLbRounds - 1]?.[0]

  if (wbFinal !== undefined && lbFinal !== undefined) {
    const grandFinalId = `${idPrefix}-gf`
    matches.push({
      id: grandFinalId,
      side: 'grandFinal',
      round: 1,
      order: 1,
      home: winnerOf(wbFinal),
      away: winnerOf(lbFinal),
      label: 'round.grandFinal',
    })

    const grandFinalIds: MatchId[] = [grandFinalId]

    if (grandFinalReset) {
      // The decider is emitted unconditionally so the bracket has a fixed shape,
      // and is simply not played if the winners-bracket finalist wins the first
      // grand final. The alternative — generating it on demand — would mean the
      // published bracket changes shape mid-tournament.
      const resetId = `${idPrefix}-gf-reset`
      matches.push({
        id: resetId,
        side: 'grandFinal',
        round: 2,
        order: 1,
        home: winnerOf(grandFinalId),
        away: loserOf(grandFinalId),
        label: 'round.grandFinalReset',
        // Played ONLY if the losers-bracket entrant (the grand final's `away`
        // side) won. If the winners-bracket finalist won, they have taken the
        // title without ever losing twice and the decider is not played.
        // Without this condition the runner-up would be handed a third defeat,
        // which contradicts the format.
        condition: { kind: 'ifAwayWon', matchId: grandFinalId },
      })
      grandFinalIds.push(resetId)
    }

    rounds.push({
      side: 'grandFinal',
      round: 1,
      matchIds: grandFinalIds,
      label: 'round.grandFinal',
    })
  }

  return { matches, rounds, byes }
}

/** Matches in a double-elimination bracket, byes included. */
export function doubleEliminationMatchCount(participantCount: number, reset = true): number {
  if (participantCount < 4) return 0
  const size = bracketSize(participantCount)
  // (size-1) winners-bracket matches + (size-2) losers-bracket matches + grand final.
  return size - 1 + (size - 2) + 1 + (reset ? 1 : 0)
}
