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

export interface SingleEliminationOptions {
  /** Adds a match between the two losing semi-finalists. */
  readonly thirdPlace?: boolean
  readonly idPrefix?: string
}

/**
 * Single elimination bracket with seeding and bye placement.
 *
 * ── Byes ────────────────────────────────────────────────────────────────────
 * A bracket must be a power of two, so 12 participants play in a 16-bracket
 * with 4 byes. Byes are assigned to the TOP seeds — seeds 13–16 are phantom, and
 * because of the seeding order those phantoms sit opposite seeds 1–4. This is
 * the conventional and fair placement: a bye is an advantage, so it goes to the
 * participants who earned the highest seeds, not to whoever happens to be last
 * in the list.
 *
 * Bye matches ARE emitted rather than skipped. A printed cuadro shows
 * "García/Ruiz — BYE" in round one; omitting the match would make the bracket
 * render with a hole, and it would make winner resolution a special case
 * everywhere downstream. The match carries a `bye` slot and resolves immediately.
 *
 * ── Structure ───────────────────────────────────────────────────────────────
 * Round 1 pairs bracket slots (0,1), (2,3), … Every later match takes the
 * winners of the two matches feeding it, referenced by id. Because ids are
 * structural (`se-r2-m1`), the whole bracket can be generated before anybody has
 * played, which is what lets the public page show the shape of the draw from the
 * moment it is published.
 */
export function generateSingleElimination(
  participantIds: readonly ParticipantId[],
  options: SingleEliminationOptions = {},
): Fixture {
  assertUniqueParticipants(participantIds)
  assertMinimum(participantIds, 2)

  const size = bracketSize(participantIds.length)
  const order = seedOrder(size)

  // Slot i holds the participant with seed order[i], or a bye if that seed
  // number exceeds the real participant count.
  const slots: Slot[] = order.map((seed) => {
    const participant = participantIds[seed - 1]
    return participant === undefined ? byeSlot() : participantSlot(participant)
  })

  return buildKnockoutBracket(slots, options)
}

/**
 * Builds a knockout bracket from slots already arranged in bracket order.
 *
 * Split out from generateSingleElimination so the group stage can reuse it with
 * `groupPosition` slots ("1º Grupo A") instead of concrete participants. The
 * bracket shape is identical either way; only what fills round one differs, and
 * duplicating this logic is how the two would drift apart.
 *
 * `slots.length` must be a power of two and already in bracket order — see
 * seedOrder().
 */
export function buildKnockoutBracket(
  slots: readonly Slot[],
  options: SingleEliminationOptions = {},
): Fixture {
  const { thirdPlace = false, idPrefix = 'se' } = options

  const size = slots.length
  const totalRounds = Math.log2(size)

  const matches: GeneratedMatch[] = []
  const rounds: FixtureRound[] = []
  const byes: { round: number; participantId: ParticipantId }[] = []

  // ── Round 1 ──────────────────────────────────────────────────────────────
  const firstRoundIds: MatchId[] = []
  const firstRoundMatchCount = size / 2

  for (let i = 0; i < firstRoundMatchCount; i += 1) {
    const home = slots[i * 2] ?? byeSlot()
    const away = slots[i * 2 + 1] ?? byeSlot()
    const id = `${idPrefix}-r1-m${String(i + 1)}`

    if (home.kind === 'bye' && away.kind === 'participant') {
      byes.push({ round: 1, participantId: away.participantId })
    } else if (away.kind === 'bye' && home.kind === 'participant') {
      byes.push({ round: 1, participantId: home.participantId })
    }

    matches.push({
      id,
      side: 'main',
      round: 1,
      order: i + 1,
      home,
      away,
      label: knockoutRoundLabel(firstRoundMatchCount),
    })
    firstRoundIds.push(id)
  }

  rounds.push({
    side: 'main',
    round: 1,
    matchIds: firstRoundIds,
    label: knockoutRoundLabel(firstRoundMatchCount),
  })

  // ── Later rounds ─────────────────────────────────────────────────────────
  let previousIds = firstRoundIds

  for (let round = 2; round <= totalRounds; round += 1) {
    const matchesInRound = size / 2 ** round
    const label = knockoutRoundLabel(matchesInRound)
    const roundIds: MatchId[] = []

    for (let i = 0; i < matchesInRound; i += 1) {
      const id = `${idPrefix}-r${String(round)}-m${String(i + 1)}`
      const feedA = previousIds[i * 2]
      const feedB = previousIds[i * 2 + 1]
      if (feedA === undefined || feedB === undefined) continue

      matches.push({
        id,
        side: 'main',
        round,
        order: i + 1,
        home: winnerOf(feedA),
        away: winnerOf(feedB),
        label,
      })
      roundIds.push(id)
    }

    rounds.push({ side: 'main', round, matchIds: roundIds, label })
    previousIds = roundIds
  }

  // ── Third place ──────────────────────────────────────────────────────────
  // Only meaningful from 4 participants up: with 2 there are no semi-finals.
  if (thirdPlace && totalRounds >= 2) {
    const semiFinals = rounds.find((r) => r.round === totalRounds - 1)
    const first = semiFinals?.matchIds[0]
    const second = semiFinals?.matchIds[1]

    if (first !== undefined && second !== undefined) {
      const id = `${idPrefix}-3rd`
      matches.push({
        id,
        side: 'thirdPlace',
        round: totalRounds,
        order: 2,
        home: loserOf(first),
        away: loserOf(second),
        label: 'round.thirdPlace',
      })
      rounds.push({
        side: 'thirdPlace',
        round: totalRounds,
        matchIds: [id],
        label: 'round.thirdPlace',
      })
    }
  }

  return { matches, rounds, byes }
}

/** Matches in a single-elimination bracket, byes included. */
export function singleEliminationMatchCount(participantCount: number, thirdPlace = false): number {
  if (participantCount < 2) return 0
  const size = bracketSize(participantCount)
  return size - 1 + (thirdPlace && size >= 4 ? 1 : 0)
}
