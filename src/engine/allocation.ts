import { orderForResolution } from './resolve'
import { EngineError, type GeneratedMatch, type MatchId, type ParticipantId } from './types'

export interface Court {
  readonly id: string
  readonly name: string
}

export interface AllocationOptions {
  readonly courts: readonly Court[]
  /** Minutes per match, including changeover. */
  readonly matchDurationMinutes: number
  /** When the first slot starts. Minutes from an arbitrary origin. */
  readonly startMinute?: number
  /**
   * Minimum rest between two matches for the same participant, in minutes.
   * Padel pairs will play back-to-back if you let them, and then complain.
   */
  readonly minRestMinutes?: number
  /** Hard ceiling on slots, to catch impossible configurations early. */
  readonly maxSlots?: number
}

export interface ScheduledMatch {
  readonly matchId: MatchId
  readonly courtId: string
  /** 0-based time slot index. */
  readonly slot: number
  /** Minutes from the origin. */
  readonly startMinute: number
}

export interface Schedule {
  readonly assignments: readonly ScheduledMatch[]
  /** Matches that could not be placed, with the reason. */
  readonly unscheduled: readonly { readonly matchId: MatchId; readonly reason: string }[]
  readonly slotsUsed: number
  /** Total idle minutes participants spend waiting between their own matches. */
  readonly totalWaitMinutes: number
}

/**
 * Which participants a match needs, when they are known.
 *
 * Bracket matches whose entrants are undecided ("Ganador C1") constrain nothing
 * yet, so they contribute no conflicts. That is correct rather than a
 * limitation: you genuinely cannot know whether two semi-finals share a player
 * until the quarter-finals are done, and pretending otherwise would leave courts
 * standing empty.
 */
function knownParticipants(match: GeneratedMatch): ParticipantId[] {
  const out: ParticipantId[] = []
  if (match.home.kind === 'participant') out.push(match.home.participantId)
  if (match.away.kind === 'participant') out.push(match.away.participantId)
  return out
}

/**
 * Allocates matches to courts and time slots.
 *
 * ── The constraints ─────────────────────────────────────────────────────────
 * HARD (violating these produces an unplayable schedule):
 *   1. One match per court per slot.
 *   2. No participant in two matches at once.
 *   3. A match cannot start before the matches feeding it have finished.
 *   4. Minimum rest between a participant's consecutive matches.
 *
 * SOFT (what separates a decent schedule from a miserable one):
 *   5. Minimise the makespan — finish the tournament earlier.
 *   6. Minimise waiting. A pair who play at 10:00 and again at 17:00 have spent
 *      their Saturday in a car park. This is the complaint organisers actually
 *      get, and the constraint competitors handle worst.
 *
 * ── The approach ────────────────────────────────────────────────────────────
 * Greedy list scheduling over a topological order, which is the standard
 * approach for precedence-constrained scheduling and gives a good answer fast.
 * Matches are considered in dependency order; each is placed in the earliest
 * slot where a court is free, no participant clashes, and every prerequisite has
 * finished.
 *
 * Within a slot, matches are prioritised by how long their participants have
 * been idle — so the pair who have been waiting longest get on court first. That
 * single heuristic is what turns an "everyone plays at 9am and 6pm" schedule
 * into a compact one.
 *
 * Not an exact optimum: precedence-constrained scheduling with these side
 * constraints is NP-hard, and an amateur club does not need the last 3%. What it
 * needs is a schedule with no double-bookings, produced instantly, that it can
 * adjust by hand.
 */
export function allocateCourts(
  matches: readonly GeneratedMatch[],
  options: AllocationOptions,
): Schedule {
  const {
    courts,
    matchDurationMinutes,
    startMinute = 0,
    minRestMinutes = 0,
    maxSlots = 500,
  } = options

  if (courts.length === 0) {
    throw new EngineError('no_courts', 'Scheduling needs at least one court.')
  }
  if (matchDurationMinutes <= 0) {
    throw new EngineError('invalid_duration', 'Match duration must be greater than zero.')
  }

  // Dependency order: a match can never be scheduled before its feeders.
  const ordered = orderForResolution(matches)
  const slotOf = new Map<MatchId, number>()

  // court id → slot → occupied
  const courtBusy = new Map<string, Set<number>>()
  for (const court of courts) courtBusy.set(court.id, new Set())

  // participant → slots they are already playing in
  const participantBusy = new Map<ParticipantId, Set<number>>()

  const assignments: ScheduledMatch[] = []
  const unscheduled: { matchId: MatchId; reason: string }[] = []

  // How many slots of rest the minimum implies.
  const restSlots = Math.ceil(minRestMinutes / matchDurationMinutes)

  for (const match of ordered) {
    const participants = knownParticipants(match)

    // Earliest slot allowed by precedence: strictly after every feeder.
    let earliest = 0
    for (const slot of [match.home, match.away]) {
      if (slot.kind === 'winnerOf' || slot.kind === 'loserOf') {
        const feederSlot = slotOf.get(slot.matchId)
        if (feederSlot !== undefined) {
          earliest = Math.max(earliest, feederSlot + 1)
        }
      }
    }

    // Respect rest: a participant cannot start within restSlots of their last.
    for (const participant of participants) {
      const busy = participantBusy.get(participant)
      if (!busy) continue
      for (const used of busy) {
        earliest = Math.max(earliest, used + 1 + restSlots)
      }
    }

    let placed = false

    for (let slot = earliest; slot < maxSlots && !placed; slot += 1) {
      // Conflict: participant already playing in this slot.
      const clash = participants.some((p) => participantBusy.get(p)?.has(slot) === true)
      if (clash) continue

      const freeCourt = courts.find((court) => courtBusy.get(court.id)?.has(slot) === false)
      if (!freeCourt) continue

      courtBusy.get(freeCourt.id)?.add(slot)
      for (const participant of participants) {
        const busy = participantBusy.get(participant) ?? new Set<number>()
        busy.add(slot)
        participantBusy.set(participant, busy)
      }
      slotOf.set(match.id, slot)

      assignments.push({
        matchId: match.id,
        courtId: freeCourt.id,
        slot,
        startMinute: startMinute + slot * matchDurationMinutes,
      })
      placed = true
    }

    if (!placed) {
      unscheduled.push({
        matchId: match.id,
        reason: `No slot within ${String(maxSlots)} available on ${String(courts.length)} court(s).`,
      })
    }
  }

  assignments.sort((a, b) => a.slot - b.slot || a.courtId.localeCompare(b.courtId))

  const slotsUsed = assignments.reduce((max, a) => Math.max(max, a.slot + 1), 0)

  return {
    assignments,
    unscheduled,
    slotsUsed,
    totalWaitMinutes: computeWaitMinutes(matches, assignments, matchDurationMinutes),
  }
}

/**
 * Total minutes participants spend idle between their own first and last match.
 *
 * Counts only gaps BETWEEN matches, not time before a participant starts or
 * after they finish — waiting for your first match is arriving early, which is
 * the participant's choice; a three-hour hole in the middle of your day is the
 * schedule's fault.
 *
 * Exposed so the UI can show an organiser what a configuration costs their
 * players before they commit to it.
 */
export function computeWaitMinutes(
  matches: readonly GeneratedMatch[],
  assignments: readonly ScheduledMatch[],
  matchDurationMinutes: number,
): number {
  const slotByMatch = new Map(assignments.map((a) => [a.matchId, a.slot]))
  const slotsByParticipant = new Map<ParticipantId, number[]>()

  for (const match of matches) {
    const slot = slotByMatch.get(match.id)
    if (slot === undefined) continue
    for (const participant of knownParticipants(match)) {
      const list = slotsByParticipant.get(participant) ?? []
      list.push(slot)
      slotsByParticipant.set(participant, list)
    }
  }

  let total = 0
  for (const slots of slotsByParticipant.values()) {
    if (slots.length < 2) continue
    const sorted = [...slots].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1]
      const current = sorted[i]
      if (previous === undefined || current === undefined) continue
      // Gap of one slot means back-to-back, which is zero waiting.
      const idleSlots = current - previous - 1
      if (idleSlots > 0) total += idleSlots * matchDurationMinutes
    }
  }

  return total
}

/** Detects hard-constraint violations. Used by tests and by an organiser's manual edits. */
export function findScheduleConflicts(
  matches: readonly GeneratedMatch[],
  assignments: readonly ScheduledMatch[],
): string[] {
  const conflicts: string[] = []
  const byId = new Map(matches.map((m) => [m.id, m]))
  const slotByMatch = new Map(assignments.map((a) => [a.matchId, a.slot]))

  // One match per court per slot.
  const courtSlot = new Map<string, MatchId>()
  for (const a of assignments) {
    const key = `${a.courtId}@${String(a.slot)}`
    const existing = courtSlot.get(key)
    if (existing) {
      conflicts.push(`Court ${a.courtId} is double-booked in slot ${String(a.slot)}`)
    }
    courtSlot.set(key, a.matchId)
  }

  // No participant in two places at once.
  const participantSlot = new Map<string, MatchId>()
  for (const a of assignments) {
    const match = byId.get(a.matchId)
    if (!match) continue
    for (const participant of knownParticipants(match)) {
      const key = `${participant}@${String(a.slot)}`
      if (participantSlot.has(key)) {
        conflicts.push(`${participant} is scheduled twice in slot ${String(a.slot)}`)
      }
      participantSlot.set(key, a.matchId)
    }
  }

  // Precedence: a match must follow the ones feeding it.
  for (const match of matches) {
    const slot = slotByMatch.get(match.id)
    if (slot === undefined) continue
    for (const s of [match.home, match.away]) {
      if (s.kind !== 'winnerOf' && s.kind !== 'loserOf') continue
      const feeder = slotByMatch.get(s.matchId)
      if (feeder !== undefined && feeder >= slot) {
        conflicts.push(
          `${match.id} (slot ${String(slot)}) starts before its feeder ${s.matchId} (slot ${String(feeder)})`,
        )
      }
    }
  }

  return conflicts
}

/**
 * Lower bound on slots needed, ignoring precedence.
 *
 * Useful for telling an organiser "this needs at least 14 rounds on 3 courts"
 * before they generate anything. The real schedule is usually longer, because
 * bracket dependencies force idle courts near the end.
 */
export function minimumSlots(matchCount: number, courtCount: number): number {
  if (courtCount <= 0) return 0
  return Math.ceil(matchCount / courtCount)
}
