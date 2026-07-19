/**
 * Chooses a generator for a tournament's format and feeds it a draw order.
 *
 * Pure: it takes ids and a seed and returns a Fixture. Persisting the result is
 * fixtureRows.ts's job, and talking to Supabase is tournamentsRepo.ts's.
 *
 * ── The draw order is where reproducibility is won or lost ───────────────────
 * Seeded participants go in seed order — that is the whole point of a seed.
 * Everyone else is shuffled, because taking them in the order they happened to
 * be pasted would let an organiser rig a bracket by sorting a spreadsheet, and
 * would make two tournaments with the same entrants produce the same draw.
 *
 * That shuffle uses createRng(draw_seed), never Math.random(). draw_seed is
 * persisted on the tournament, so a disputed bracket can be regenerated and
 * shown to be identical. A Math.random() draw is unfalsifiable — the organiser
 * cannot prove they did not re-roll it until they liked the result.
 */

import {
  createRng,
  generateDoubleElimination,
  generateGroupsToKnockout,
  generateRoundRobin,
  generateSingleElimination,
  orderBySeed,
  pairSwissRound,
  shuffle,
  type Fixture,
} from '~/engine'
import type { TournamentFormat } from '~/data/supabase/database.types'

/** Format-specific options, stored on `tournaments.config`. */
export interface FixtureConfig {
  /** Round robin and group stages: 1 = single, 2 = ida y vuelta. */
  readonly legs?: 1 | 2
  /** Knockout: adds a match between the losing semi-finalists. */
  readonly thirdPlace?: boolean
  /** Group stage: how many groups to split the field into. */
  readonly groups?: number
  /** Group stage: how many from each group reach the knockout. */
  readonly qualifiersPerGroup?: number
}

export interface DrawParticipant {
  readonly id: string
  readonly seed: number | null
}

/**
 * Orders participants for the draw: seeds first in order, everyone else
 * shuffled deterministically from `drawSeed`.
 */
export function orderParticipantsForDraw(
  participants: readonly DrawParticipant[],
  drawSeed: number,
): string[] {
  const rng = createRng(drawSeed)

  const seeded = participants.filter((p) => p.seed !== null)
  // Shuffled BEFORE orderBySeed places them, so the unseeded half of the draw
  // does not simply mirror the paste order.
  const unseeded = shuffle(
    participants.filter((p) => p.seed === null),
    rng,
  )

  return orderBySeed(
    [...seeded, ...unseeded].map((p) => ({
      id: p.id,
      seed: p.seed ?? undefined,
    })),
  ).map((p) => p.id)
}

export interface GenerateFixtureOptions {
  readonly format: TournamentFormat
  readonly participants: readonly DrawParticipant[]
  readonly drawSeed: number
  readonly config?: FixtureConfig
}

export function generateFixtureForFormat({
  format,
  participants,
  drawSeed,
  config = {},
}: GenerateFixtureOptions): Fixture {
  const ids = orderParticipantsForDraw(participants, drawSeed)

  switch (format) {
    case 'round_robin':
      return generateRoundRobin(ids, { legs: config.legs ?? 1 })

    case 'single_elim':
      return generateSingleElimination(ids, { thirdPlace: config.thirdPlace ?? false })

    case 'double_elim':
      return generateDoubleElimination(ids)

    case 'groups_knockout':
      return generateGroupsToKnockout(ids, {
        groups: config.groups ?? defaultGroupCount(ids.length),
        qualifiersPerGroup: config.qualifiersPerGroup ?? 2,
        legs: config.legs ?? 1,
        thirdPlace: config.thirdPlace ?? false,
      })

    case 'swiss': {
      // Swiss is the one format that cannot be generated in full up front: each
      // round is paired from the results of the previous one, which is the
      // point of the format. Only round 1 exists at creation time; milestone 5
      // pairs each subsequent round as results arrive.
      const first = pairSwissRound(ids, [], 1)
      return {
        matches: first.matches,
        rounds: [
          {
            side: 'main',
            round: first.round,
            matchIds: first.matches.map((m) => m.id),
            // Structural, not prose — the UI renders "Ronda 1" from the index.
            label: 'swiss',
          },
        ],
        byes: first.bye === null ? [] : [{ round: first.round, participantId: first.bye }],
      }
    }
  }
}

/**
 * Groups of four when the field divides that way, which is the size most club
 * organisers reach for: three matches each, everyone plays, and it fits a
 * morning. Falls back to two groups for small fields.
 */
function defaultGroupCount(participantCount: number): number {
  if (participantCount < 8) return 2
  return Math.max(2, Math.round(participantCount / 4))
}
