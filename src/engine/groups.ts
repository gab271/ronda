import { generateRoundRobin } from './roundRobin'
import { bracketSize, seedOrder } from './seeding'
import { buildKnockoutBracket } from './singleElimination'
import { computeStandings, type StandingsOptions } from './standings'
import {
  EngineError,
  assertMinimum,
  assertUniqueParticipants,
  byeSlot,
  groupPosition,
  type Fixture,
  type FixtureRound,
  type GeneratedMatch,
  type MatchResult,
  type ParticipantId,
  type Slot,
} from './types'

export interface GroupStageOptions {
  /** How many groups to split the field into. */
  readonly groups: number
  /** How many from each group reach the knockout. Defaults to 2. */
  readonly qualifiersPerGroup?: number
  /** Round robin legs within each group. */
  readonly legs?: 1 | 2
  readonly thirdPlace?: boolean
  readonly idPrefix?: string
}

export interface Group {
  readonly label: string
  readonly participantIds: readonly ParticipantId[]
}

export interface GroupStageFixture extends Fixture {
  readonly groups: readonly Group[]
}

/** Group labels: A, B, C… then A1, B1 beyond 26, which no club will ever hit. */
export function groupLabel(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index)
  return `${String.fromCharCode(65 + (index % 26))}${String(Math.floor(index / 26))}`
}

/**
 * Distributes participants into groups by serpentine ("snake") seeding.
 *
 * With 4 groups and 16 seeds:
 *
 *   A: 1, 8,  9, 16
 *   B: 2, 7, 10, 15
 *   C: 3, 6, 11, 14
 *   D: 4, 5, 12, 13
 *
 * Straight dealing (1,2,3,4 / 5,6,7,8 / …) would put seeds 1–4 in group A and
 * the four weakest in group D, so one group is a bloodbath and another is a
 * stroll. Reversing direction every pass balances total group strength, which is
 * what makes qualification comparable across groups.
 */
export function assignGroups(
  participantIds: readonly ParticipantId[],
  groupCount: number,
): Group[] {
  const buckets: ParticipantId[][] = Array.from({ length: groupCount }, () => [])

  participantIds.forEach((id, index) => {
    const pass = Math.floor(index / groupCount)
    const position = index % groupCount
    // Reverse direction on every second pass — the serpentine.
    const bucket = pass % 2 === 0 ? position : groupCount - 1 - position
    buckets[bucket]?.push(id)
  })

  return buckets.map((participantIds, index) => ({
    label: groupLabel(index),
    participantIds,
  }))
}

/**
 * Arranges qualifier slots so that group rivals cannot meet in round one.
 *
 * In a bracket, seed k plays seed (size+1-k) in the first round. So placing the
 * runner-up of group g opposite the winner of the SAME group is the one thing to
 * avoid: two pairs travel to a tournament, play each other in the group, and
 * then immediately play each other again. It reads as a broken draw.
 *
 * The scheme: group winners take seeds 1..G in group order. Runners-up are
 * placed so that the winner of group g faces the runner-up of group g+1
 * (wrapping around). Working through the mirror arithmetic, the runner-up of
 * group (j+1 mod G) must sit at seed (2G - j) for winner j at seed (j+1).
 *
 * For deeper qualification (3rd place onward) the same rotation is applied per
 * level. Same-group avoidance in round one is GUARANTEED for up to two
 * qualifiers per group, and merely likely beyond that — which is fine, because
 * taking three from a group of four barely eliminates anyone and is rare.
 */
export function seedQualifierSlots(
  groupCount: number,
  qualifiersPerGroup: number,
): Slot[] {
  const total = groupCount * qualifiersPerGroup
  const size = bracketSize(total)
  const seeded: (Slot | undefined)[] = Array.from({ length: size }, () => undefined)

  for (let level = 0; level < qualifiersPerGroup; level += 1) {
    for (let g = 0; g < groupCount; g += 1) {
      let seedIndex: number

      if (level === 0) {
        // Winners: straight down the seeds.
        seedIndex = g
      } else if (level === 1) {
        // Runners-up: mirrored and rotated by one group.
        // winner j sits at index j, faces index (2G - 1 - j) within this level's
        // block; we want that to be runner-up of group (j+1) mod G.
        const j = (g - 1 + groupCount) % groupCount
        seedIndex = 2 * groupCount - 1 - j
      } else {
        // Deeper levels: rotate by the level so a group's entrants spread out.
        seedIndex = level * groupCount + ((g + level) % groupCount)
      }

      if (seedIndex < size) {
        seeded[seedIndex] = groupPosition(groupLabel(g), level + 1)
      }
    }
  }

  // Any unfilled seed is a bye (the qualifier count is not a power of two).
  const inSeedOrder: Slot[] = seeded.map((slot) => slot ?? byeSlot())

  // buildKnockoutBracket expects BRACKET order, not seed order, so apply the
  // standard seed→slot mapping.
  return seedOrder(size).map((seed) => inSeedOrder[seed - 1] ?? byeSlot())
}

/**
 * Group stage feeding a knockout bracket.
 *
 * Both halves are generated up front. The knockout matches reference their
 * entrants as `groupPosition` slots — "1º Grupo A" — so the public page can show
 * the full shape of the tournament from the moment it is published, before a
 * single group match has been played. Generating the knockout only once the
 * groups finish would mean the draw sheet is half-empty for most of the event,
 * which is precisely when people are looking at it.
 */
export function generateGroupsToKnockout(
  participantIds: readonly ParticipantId[],
  options: GroupStageOptions,
): GroupStageFixture {
  assertUniqueParticipants(participantIds)
  assertMinimum(participantIds, 4)

  const {
    groups: groupCount,
    qualifiersPerGroup = 2,
    legs = 1,
    thirdPlace = false,
    idPrefix = 'gk',
  } = options

  if (groupCount < 1) {
    throw new EngineError('invalid_group_count', 'A group stage needs at least one group.')
  }
  if (groupCount > participantIds.length) {
    throw new EngineError(
      'invalid_group_count',
      `Cannot split ${String(participantIds.length)} participants into ${String(groupCount)} groups.`,
    )
  }

  const groups = assignGroups(participantIds, groupCount)

  for (const group of groups) {
    if (group.participantIds.length < qualifiersPerGroup) {
      throw new EngineError(
        'too_few_in_group',
        `Group ${group.label} has ${String(group.participantIds.length)} participants but ` +
          `${String(qualifiersPerGroup)} must qualify. Use fewer groups or fewer qualifiers.`,
      )
    }
    if (group.participantIds.length < 2) {
      throw new EngineError(
        'too_few_in_group',
        `Group ${group.label} has fewer than two participants. Use fewer groups.`,
      )
    }
  }

  const matches: GeneratedMatch[] = []
  const rounds: FixtureRound[] = []
  const byes: { round: number; participantId: ParticipantId }[] = []

  // ── Group round robins ───────────────────────────────────────────────────
  for (const group of groups) {
    const fixture = generateRoundRobin(group.participantIds, {
      legs,
      idPrefix: `${idPrefix}-g${group.label}`,
      group: group.label,
    })
    matches.push(...fixture.matches)
    rounds.push(...fixture.rounds.map((round) => ({ ...round, label: `group.${group.label}` })))
    byes.push(...fixture.byes)
  }

  // ── Knockout ─────────────────────────────────────────────────────────────
  const qualifierSlots = seedQualifierSlots(groupCount, qualifiersPerGroup)

  // One group taking two qualifiers has nothing to knock out — the group IS the
  // tournament. Emit only the groups in that case.
  if (qualifierSlots.length >= 2 && groupCount * qualifiersPerGroup >= 2) {
    const knockout = buildKnockoutBracket(qualifierSlots, {
      thirdPlace,
      idPrefix: `${idPrefix}-ko`,
    })
    matches.push(...knockout.matches)
    rounds.push(...knockout.rounds)
  }

  return { matches, rounds, byes, groups }
}

/**
 * Resolves `groupPosition` slots once group results are in.
 *
 * Returns a map from "A:1" (first in group A) to the participant who finished
 * there. Feed it to the bracket renderer to turn placeholders into names.
 *
 * Groups that are not yet decided are simply absent from the map, so a
 * half-finished group stage renders as a partially-resolved bracket rather than
 * failing.
 */
export function resolveGroupQualifiers(
  groups: readonly Group[],
  results: readonly MatchResult[],
  options: StandingsOptions = {},
): Map<string, ParticipantId> {
  const resolved = new Map<string, ParticipantId>()

  for (const group of groups) {
    const memberIds = new Set(group.participantIds)
    const groupResults = results.filter(
      (r) => memberIds.has(r.homeParticipantId) && memberIds.has(r.awayParticipantId),
    )

    const standings = computeStandings(group.participantIds, groupResults, options)

    standings.forEach((row, index) => {
      resolved.set(`${group.label}:${String(index + 1)}`, row.participantId)
    })
  }

  return resolved
}

/** Looks up a `groupPosition` slot in the map from resolveGroupQualifiers. */
export function resolveGroupSlot(
  slot: Slot,
  qualifiers: ReadonlyMap<string, ParticipantId>,
): ParticipantId | null {
  if (slot.kind !== 'groupPosition') return null
  return qualifiers.get(`${slot.group}:${String(slot.position)}`) ?? null
}
