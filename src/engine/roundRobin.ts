import {
  assertMinimum,
  assertUniqueParticipants,
  byeSlot,
  participantSlot,
  type Fixture,
  type FixtureRound,
  type GeneratedMatch,
  type MatchId,
  type ParticipantId,
  type Slot,
} from './types'

export interface RoundRobinOptions {
  /** 1 = single round robin, 2 = ida y vuelta (each pair meets twice). */
  readonly legs?: 1 | 2
  /** Prefix for generated match ids, so several stages can coexist. */
  readonly idPrefix?: string
  /** Group label, when this round robin is one group of a group stage. */
  readonly group?: string
}

/**
 * Round robin using the circle method.
 *
 * Everyone plays everyone once (or twice with `legs: 2`). With n participants
 * there are n-1 rounds when n is even, and n rounds when n is odd — because an
 * odd count needs a phantom participant so that someone sits out each round.
 *
 * ── The algorithm ───────────────────────────────────────────────────────────
 * Fix the first participant in place and rotate all the others around them. In
 * each round, pair the array front-to-back: position i plays position n-1-i.
 * After n-1 rotations every pair has met exactly once.
 *
 * Why the circle method rather than nested loops: nested loops produce a valid
 * set of pairings but no valid *schedule* — they'd put the same participant in
 * several concurrent matches. The circle method emits rounds in which nobody
 * appears twice, which is what makes court allocation possible at all.
 *
 * ── Byes ────────────────────────────────────────────────────────────────────
 * An odd participant count is padded with a phantom entry. The participant
 * drawn against it sits that round out. The rotation guarantees the bye moves
 * around, so nobody sits out twice before everyone has sat out once.
 *
 * ── Home/away balance ───────────────────────────────────────────────────────
 * The naive circle method gives the fixed participant the same side every
 * round. Alternating the pairing direction on odd rounds spreads home and away
 * roughly evenly. For padel this only affects which name is printed first; for
 * football 7 it decides who is actually at home, so it is worth doing properly.
 */
export function generateRoundRobin(
  participantIds: readonly ParticipantId[],
  options: RoundRobinOptions = {},
): Fixture {
  assertUniqueParticipants(participantIds)
  assertMinimum(participantIds, 2)

  const { legs = 1, idPrefix = 'rr', group } = options

  // BYE is a sentinel, never a real id. Padding to an even count is what makes
  // one clean rotation work for both parities.
  const BYE = Symbol('bye')
  const entries: (ParticipantId | typeof BYE)[] = [...participantIds]
  const hasPhantom = entries.length % 2 === 1
  if (hasPhantom) entries.push(BYE)

  const n = entries.length
  const roundsPerLeg = n - 1
  const matchesPerRound = n / 2

  const matches: GeneratedMatch[] = []
  const rounds: FixtureRound[] = []
  const byes: { round: number; participantId: ParticipantId }[] = []

  // Working array, rotated in place. Index 0 stays fixed throughout.
  const wheel = [...entries]

  for (let leg = 0; leg < legs; leg += 1) {
    for (let r = 0; r < roundsPerLeg; r += 1) {
      const roundNumber = leg * roundsPerLeg + r + 1
      const matchIds: MatchId[] = []
      let order = 0

      for (let i = 0; i < matchesPerRound; i += 1) {
        const a = wheel[i]
        const b = wheel[n - 1 - i]
        if (a === undefined || b === undefined) continue

        if (a === BYE || b === BYE) {
          const resting = a === BYE ? b : a
          if (resting !== BYE) {
            byes.push({ round: roundNumber, participantId: resting })
          }
          continue
        }

        order += 1
        const id = `${idPrefix}-r${String(roundNumber)}-m${String(order)}`

        // Alternate sides so the fixed participant is not always "home", and
        // swap again on the second leg so a pair's return fixture is reversed.
        const swap = (r % 2 === 1) !== (leg === 1)
        const home: Slot = participantSlot(swap ? b : a)
        const away: Slot = participantSlot(swap ? a : b)

        matches.push({
          id,
          side: 'group',
          round: roundNumber,
          order,
          home,
          away,
          ...(group === undefined ? {} : { group }),
          label: `round.${String(roundNumber)}`,
        })
        matchIds.push(id)
      }

      rounds.push({
        side: 'group',
        round: roundNumber,
        matchIds,
        label: `round.${String(roundNumber)}`,
      })

      // Rotate: hold index 0, move the last entry into position 1.
      const last = wheel.pop()
      if (last !== undefined) wheel.splice(1, 0, last)
    }
  }

  return { matches, rounds, byes }
}

/**
 * Total matches in a round robin, without generating it.
 *
 * n*(n-1)/2 per leg — used by the UI to warn an organiser before they commit to
 * a format. Sixteen pairs is 120 matches, which at 40 minutes a match on 4
 * courts is a 20-hour tournament. Better to say so before generating than after.
 */
export function roundRobinMatchCount(participantCount: number, legs: 1 | 2 = 1): number {
  if (participantCount < 2) return 0
  return ((participantCount * (participantCount - 1)) / 2) * legs
}

/** Rounds needed, including the sit-out round an odd count forces. */
export function roundRobinRoundCount(participantCount: number, legs: 1 | 2 = 1): number {
  if (participantCount < 2) return 0
  const padded = participantCount % 2 === 0 ? participantCount : participantCount + 1
  return (padded - 1) * legs
}

/** Re-export for callers building a bye-aware UI. */
export { byeSlot }
