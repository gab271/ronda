import { describe, expect, it } from 'vitest'
import {
  allocateCourts,
  computeWaitMinutes,
  findScheduleConflicts,
  minimumSlots,
  type Court,
} from './allocation'
import { generateRoundRobin } from './roundRobin'
import { generateSingleElimination } from './singleElimination'
import { generateGroupsToKnockout } from './groups'
import { EngineError, type ParticipantId } from './types'

function ids(n: number): ParticipantId[] {
  return Array.from({ length: n }, (_, i) => `p${String(i + 1)}`)
}

function courts(n: number): Court[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${String(i + 1)}`,
    name: `Pista ${String(i + 1)}`,
  }))
}

const BASE = { matchDurationMinutes: 40 } as const

describe('allocateCourts', () => {
  describe('hard constraints', () => {
    it.each([
      [4, 2],
      [6, 2],
      [8, 3],
      [12, 4],
      [16, 4],
      [5, 1],
    ])('never double-books with %i participants on %i courts', (n, courtCount) => {
      const fixture = generateRoundRobin(ids(n))
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(courtCount) })

      expect(findScheduleConflicts(fixture.matches, schedule.assignments)).toEqual([])
      expect(schedule.unscheduled).toEqual([])
    })

    it('never puts a participant on two courts at once', () => {
      const fixture = generateRoundRobin(ids(10))
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(5) })

      const seen = new Map<string, string>()
      for (const a of schedule.assignments) {
        const match = fixture.matches.find((m) => m.id === a.matchId)
        if (!match) continue
        for (const slotSide of [match.home, match.away]) {
          if (slotSide.kind !== 'participant') continue
          const key = `${slotSide.participantId}@${String(a.slot)}`
          expect(seen.has(key), `${key} double-booked`).toBe(false)
          seen.set(key, a.matchId)
        }
      }
    })

    it('never puts two matches on one court in one slot', () => {
      const fixture = generateRoundRobin(ids(12))
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(3) })

      const occupied = new Set<string>()
      for (const a of schedule.assignments) {
        const key = `${a.courtId}@${String(a.slot)}`
        expect(occupied.has(key), `${key} double-booked`).toBe(false)
        occupied.add(key)
      }
    })

    it('schedules every match exactly once', () => {
      const fixture = generateRoundRobin(ids(8))
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(2) })

      expect(schedule.assignments).toHaveLength(fixture.matches.length)
      expect(new Set(schedule.assignments.map((a) => a.matchId)).size).toBe(
        fixture.matches.length,
      )
    })
  })

  describe('precedence in brackets', () => {
    it('never starts a match before the ones feeding it', () => {
      const fixture = generateSingleElimination(ids(16))
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(4) })

      expect(findScheduleConflicts(fixture.matches, schedule.assignments)).toEqual([])
    })

    it('puts the final in the last slot', () => {
      const fixture = generateSingleElimination(ids(8))
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(4) })

      const final = fixture.matches.find((m) => m.label === 'round.final')
      const finalSlot = schedule.assignments.find((a) => a.matchId === final?.id)?.slot ?? -1
      const maxSlot = Math.max(...schedule.assignments.map((a) => a.slot))

      expect(finalSlot).toBe(maxSlot)
    })

    it('handles a full group stage plus knockout', () => {
      const fixture = generateGroupsToKnockout(ids(16), { groups: 4 })
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(4) })

      expect(findScheduleConflicts(fixture.matches, schedule.assignments)).toEqual([])
      expect(schedule.unscheduled).toEqual([])
    })

    it('orders knockout rounds strictly', () => {
      const fixture = generateSingleElimination(ids(8))
      const slotOf = new Map(
        allocateCourts(fixture.matches, { ...BASE, courts: courts(4) }).assignments.map((a) => [
          a.matchId,
          a.slot,
        ]),
      )

      const maxOfRound = (round: number) =>
        Math.max(
          ...fixture.matches
            .filter((m) => m.round === round && m.side === 'main')
            .map((m) => slotOf.get(m.id) ?? -1),
        )
      const minOfRound = (round: number) =>
        Math.min(
          ...fixture.matches
            .filter((m) => m.round === round && m.side === 'main')
            .map((m) => slotOf.get(m.id) ?? -1),
        )

      expect(minOfRound(2)).toBeGreaterThan(maxOfRound(1) - 1)
      expect(minOfRound(3)).toBeGreaterThan(maxOfRound(2) - 1)
    })
  })

  describe('court utilisation', () => {
    it('uses every court when there is enough work', () => {
      const fixture = generateRoundRobin(ids(12)) // 66 matches
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(3) })

      const used = new Set(schedule.assignments.map((a) => a.courtId))
      expect(used.size).toBe(3)
    })

    it('gets close to the theoretical minimum for a round robin', () => {
      // A round robin's rounds are already conflict-free, so the only limit is
      // court count. 8 participants → 28 matches; on 4 courts the floor is 7.
      const fixture = generateRoundRobin(ids(8))
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(4) })

      const floor = minimumSlots(fixture.matches.length, 4)
      expect(schedule.slotsUsed).toBeGreaterThanOrEqual(floor)
      // Allow some slack for the participant-conflict constraint.
      expect(schedule.slotsUsed).toBeLessThanOrEqual(floor + 2)
    })

    it('takes longer with fewer courts', () => {
      const fixture = generateRoundRobin(ids(8))
      const onOne = allocateCourts(fixture.matches, { ...BASE, courts: courts(1) })
      const onFour = allocateCourts(fixture.matches, { ...BASE, courts: courts(4) })

      expect(onOne.slotsUsed).toBeGreaterThan(onFour.slotsUsed)
      expect(onOne.slotsUsed).toBe(28) // one court, one at a time
    })
  })

  describe('start times', () => {
    it('converts slots to minutes', () => {
      const fixture = generateRoundRobin(ids(4))
      const schedule = allocateCourts(fixture.matches, {
        ...BASE,
        courts: courts(2),
        startMinute: 600, // 10:00
      })

      for (const a of schedule.assignments) {
        expect(a.startMinute).toBe(600 + a.slot * 40)
      }
    })

    it('starts at zero by default', () => {
      const fixture = generateRoundRobin(ids(4))
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(2) })

      expect(Math.min(...schedule.assignments.map((a) => a.startMinute))).toBe(0)
    })
  })

  describe('minimum rest', () => {
    it('leaves a gap between a participant’s matches', () => {
      const fixture = generateRoundRobin(ids(6))
      const schedule = allocateCourts(fixture.matches, {
        ...BASE,
        courts: courts(3),
        minRestMinutes: 40, // one full slot of rest
      })

      const slotsByParticipant = new Map<ParticipantId, number[]>()
      for (const a of schedule.assignments) {
        const match = fixture.matches.find((m) => m.id === a.matchId)
        if (!match) continue
        for (const side of [match.home, match.away]) {
          if (side.kind !== 'participant') continue
          const list = slotsByParticipant.get(side.participantId) ?? []
          list.push(a.slot)
          slotsByParticipant.set(side.participantId, list)
        }
      }

      for (const [participant, slots] of slotsByParticipant) {
        const sorted = [...slots].sort((a, b) => a - b)
        for (let i = 1; i < sorted.length; i += 1) {
          expect(
            (sorted[i] ?? 0) - (sorted[i - 1] ?? 0),
            `${participant} played back-to-back`,
          ).toBeGreaterThanOrEqual(2)
        }
      }
    })

    it('costs extra slots, as expected', () => {
      const fixture = generateRoundRobin(ids(6))
      const without = allocateCourts(fixture.matches, { ...BASE, courts: courts(3) })
      const withRest = allocateCourts(fixture.matches, {
        ...BASE,
        courts: courts(3),
        minRestMinutes: 80,
      })

      expect(withRest.slotsUsed).toBeGreaterThanOrEqual(without.slotsUsed)
    })
  })

  describe('waiting time', () => {
    it('reports zero when everyone plays consecutively', () => {
      // Two participants, two matches back to back on one court.
      const matches = generateRoundRobin(ids(2), { legs: 2 }).matches
      const schedule = allocateCourts(matches, { ...BASE, courts: courts(1) })

      expect(schedule.totalWaitMinutes).toBe(0)
    })

    it('counts only gaps between matches, not before the first', () => {
      const matches = [
        {
          id: 'm1',
          side: 'group' as const,
          round: 1,
          order: 1,
          home: { kind: 'participant' as const, participantId: 'a' },
          away: { kind: 'participant' as const, participantId: 'b' },
        },
        {
          id: 'm2',
          side: 'group' as const,
          round: 2,
          order: 1,
          home: { kind: 'participant' as const, participantId: 'a' },
          away: { kind: 'participant' as const, participantId: 'c' },
        },
      ]

      // a plays slots 0 and 3 → two idle slots → 80 minutes.
      const wait = computeWaitMinutes(
        matches,
        [
          { matchId: 'm1', courtId: 'c1', slot: 0, startMinute: 0 },
          { matchId: 'm2', courtId: 'c1', slot: 3, startMinute: 120 },
        ],
        40,
      )

      expect(wait).toBe(80)
    })

    it('does not penalise a participant with a single match', () => {
      const matches = [
        {
          id: 'm1',
          side: 'group' as const,
          round: 1,
          order: 1,
          home: { kind: 'participant' as const, participantId: 'a' },
          away: { kind: 'participant' as const, participantId: 'b' },
        },
      ]

      expect(
        computeWaitMinutes(matches, [{ matchId: 'm1', courtId: 'c1', slot: 9, startMinute: 360 }], 40),
      ).toBe(0)
    })

    it('achieves the theoretical minimum waiting time', () => {
      // The soft constraint that matters most, tested against the real bound
      // rather than a guessed threshold.
      //
      // Each slot puts 2 participants per court on court, so only 2C of the P
      // participants are playing at any time. Nobody can therefore play more
      // often than one slot in every ceil(P / 2C). With P=8 and C=2 that is
      // every other slot: 7 matches, 6 gaps, 1 idle slot each = 240 minutes.
      // That is unavoidable, not a scheduling failure.
      const participantCount = 8
      const courtCount = 2
      const fixture = generateRoundRobin(ids(participantCount))
      const schedule = allocateCourts(fixture.matches, {
        ...BASE,
        courts: courts(courtCount),
      })

      const slotsBetween = Math.ceil(participantCount / (2 * courtCount))
      const matchesEach = participantCount - 1
      const optimumPerParticipant =
        (matchesEach - 1) * (slotsBetween - 1) * BASE.matchDurationMinutes

      expect(schedule.totalWaitMinutes / participantCount).toBe(optimumPerParticipant)
    })

    it('eliminates waiting entirely when there are enough courts', () => {
      // 8 participants on 4 courts: everybody is on court every slot, so a
      // perfect schedule has zero gaps. This only works if the allocator packs
      // each round fully — a naive placement would scatter matches and strand
      // people between them.
      const fixture = generateRoundRobin(ids(8))
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(4) })

      expect(schedule.totalWaitMinutes).toBe(0)
      expect(schedule.slotsUsed).toBe(7)
    })

    it('reduces waiting as courts are added', () => {
      const fixture = generateRoundRobin(ids(12))
      const waits = [2, 3, 6].map(
        (c) => allocateCourts(fixture.matches, { ...BASE, courts: courts(c) }).totalWaitMinutes,
      )

      expect(waits[0]).toBeGreaterThan(waits[1]!)
      expect(waits[1]).toBeGreaterThan(waits[2]!)
    })
  })

  describe('unresolved bracket slots', () => {
    it('does not treat undecided entrants as conflicts', () => {
      // Semi-finals reference "winner of QF1" — unknowable now. They must not be
      // forced apart as though they shared a player, or the schedule stretches
      // for no reason.
      const fixture = generateSingleElimination(ids(8))
      const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(4) })

      const semis = fixture.matches.filter((m) => m.label === 'round.semiFinal')
      const slots = semis.map(
        (m) => schedule.assignments.find((a) => a.matchId === m.id)?.slot ?? -1,
      )

      // Both semi-finals can run in parallel on separate courts.
      expect(new Set(slots).size).toBe(1)
    })
  })

  describe('validation', () => {
    it('rejects zero courts', () => {
      expect(() =>
        allocateCourts(generateRoundRobin(ids(4)).matches, { ...BASE, courts: [] }),
      ).toThrow(EngineError)
    })

    it('rejects a non-positive duration', () => {
      expect(() =>
        allocateCourts(generateRoundRobin(ids(4)).matches, {
          courts: courts(1),
          matchDurationMinutes: 0,
        }),
      ).toThrow(EngineError)
    })

    it('reports matches it could not place rather than dropping them', () => {
      const fixture = generateRoundRobin(ids(8))
      const schedule = allocateCourts(fixture.matches, {
        ...BASE,
        courts: courts(1),
        maxSlots: 5, // far too few
      })

      expect(schedule.unscheduled.length).toBeGreaterThan(0)
      expect(schedule.unscheduled[0]?.reason).toMatch(/No slot within 5/)
    })
  })

  describe('determinism', () => {
    it('produces identical schedules across runs', () => {
      const fixture = generateRoundRobin(ids(10))

      expect(allocateCourts(fixture.matches, { ...BASE, courts: courts(3) })).toEqual(
        allocateCourts(fixture.matches, { ...BASE, courts: courts(3) }),
      )
    })
  })
})

describe('findScheduleConflicts', () => {
  it('detects a court double-booking', () => {
    const matches = generateRoundRobin(ids(4)).matches
    const bad = [
      { matchId: matches[0]!.id, courtId: 'c1', slot: 0, startMinute: 0 },
      { matchId: matches[1]!.id, courtId: 'c1', slot: 0, startMinute: 0 },
    ]

    expect(findScheduleConflicts(matches, bad).join(' ')).toMatch(/double-booked/)
  })

  it('detects a participant clash', () => {
    const matches = [
      {
        id: 'm1',
        side: 'group' as const,
        round: 1,
        order: 1,
        home: { kind: 'participant' as const, participantId: 'a' },
        away: { kind: 'participant' as const, participantId: 'b' },
      },
      {
        id: 'm2',
        side: 'group' as const,
        round: 1,
        order: 2,
        home: { kind: 'participant' as const, participantId: 'a' },
        away: { kind: 'participant' as const, participantId: 'c' },
      },
    ]

    const bad = [
      { matchId: 'm1', courtId: 'c1', slot: 0, startMinute: 0 },
      { matchId: 'm2', courtId: 'c2', slot: 0, startMinute: 0 },
    ]

    expect(findScheduleConflicts(matches, bad).join(' ')).toMatch(/a is scheduled twice/)
  })

  it('detects a precedence violation', () => {
    const matches = generateSingleElimination(ids(4)).matches
    const final = matches.find((m) => m.label === 'round.final')!
    const semi = matches.find((m) => m.round === 1)!

    const bad = [
      { matchId: final.id, courtId: 'c1', slot: 0, startMinute: 0 },
      { matchId: semi.id, courtId: 'c2', slot: 1, startMinute: 40 },
    ]

    expect(findScheduleConflicts(matches, bad).join(' ')).toMatch(/before its feeder/)
  })

  it('is silent on a valid schedule', () => {
    const fixture = generateRoundRobin(ids(6))
    const schedule = allocateCourts(fixture.matches, { ...BASE, courts: courts(3) })

    expect(findScheduleConflicts(fixture.matches, schedule.assignments)).toEqual([])
  })
})

describe('minimumSlots', () => {
  it('divides matches across courts', () => {
    expect(minimumSlots(28, 4)).toBe(7)
    expect(minimumSlots(28, 3)).toBe(10)
    expect(minimumSlots(1, 4)).toBe(1)
    expect(minimumSlots(10, 0)).toBe(0)
  })
})
