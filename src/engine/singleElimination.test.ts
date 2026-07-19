import { describe, expect, it } from 'vitest'
import {
  generateSingleElimination,
  singleEliminationMatchCount,
} from './singleElimination'
import { bracketSize, knockoutRoundLabel, seedOrder } from './seeding'
import { bracketChampion, simulateBracket } from './resolve'
import { EngineError, type GeneratedMatch, type ParticipantId } from './types'

function ids(n: number): ParticipantId[] {
  return Array.from({ length: n }, (_, i) => `p${String(i + 1)}`)
}

/**
 * Plays out a bracket where the better seed always wins.
 *
 * Uses the production resolver rather than a test-local reimplementation, so
 * these tests exercise resolve.ts too — a second implementation here would let
 * the two drift and hide a bug in the one that actually ships.
 */
function playOut(
  matches: readonly GeneratedMatch[],
  seedOf: (id: ParticipantId) => number,
): ParticipantId {
  const outcomes = simulateBracket(matches, (home, away) =>
    seedOf(home) <= seedOf(away) ? home : away,
  )
  const champion = bracketChampion(matches, outcomes)
  if (!champion) throw new Error('bracket produced no champion')
  return champion
}

describe('seedOrder', () => {
  it('produces the standard orders', () => {
    expect(seedOrder(2)).toEqual([1, 2])
    expect(seedOrder(4)).toEqual([1, 4, 2, 3])
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11])
  })

  it('contains every seed exactly once', () => {
    for (const size of [2, 4, 8, 16, 32, 64]) {
      const order = seedOrder(size)
      expect(order).toHaveLength(size)
      expect(new Set(order).size).toBe(size)
      expect(Math.min(...order)).toBe(1)
      expect(Math.max(...order)).toBe(size)
    }
  })

  it('pairs each seed with its complement in round one', () => {
    for (const size of [4, 8, 16, 32]) {
      const order = seedOrder(size)
      for (let i = 0; i < size; i += 2) {
        expect((order[i] ?? 0) + (order[i + 1] ?? 0)).toBe(size + 1)
      }
    }
  })

  it('rejects a non-power-of-two size', () => {
    expect(() => seedOrder(6)).toThrow(EngineError)
  })
})

describe('bracketSize', () => {
  it.each([
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 8],
    [8, 8],
    [9, 16],
    [12, 16],
    [16, 16],
    [17, 32],
  ])('%i participants needs a bracket of %i', (n, expected) => {
    expect(bracketSize(n)).toBe(expected)
  })
})

describe('knockoutRoundLabel', () => {
  it('names the late rounds specifically', () => {
    expect(knockoutRoundLabel(1)).toBe('round.final')
    expect(knockoutRoundLabel(2)).toBe('round.semiFinal')
    expect(knockoutRoundLabel(4)).toBe('round.quarterFinal')
    expect(knockoutRoundLabel(8)).toBe('round.roundOf16')
    expect(knockoutRoundLabel(16)).toBe('round.roundOf32')
  })
})

describe('generateSingleElimination', () => {
  describe.each([2, 3, 4, 5, 6, 7, 8, 11, 12, 16, 24, 32])('with %i participants', (n) => {
    const participants = ids(n)
    const fixture = generateSingleElimination(participants)

    it('emits the right number of matches', () => {
      expect(fixture.matches).toHaveLength(singleEliminationMatchCount(n))
    })

    it('has exactly one final', () => {
      const finals = fixture.matches.filter((m) => m.label === 'round.final' && m.side === 'main')
      expect(finals).toHaveLength(1)
    })

    it('includes every participant exactly once in round one', () => {
      const appearing: ParticipantId[] = []
      for (const m of fixture.matches.filter((x) => x.round === 1)) {
        if (m.home.kind === 'participant') appearing.push(m.home.participantId)
        if (m.away.kind === 'participant') appearing.push(m.away.participantId)
      }

      expect(new Set(appearing).size).toBe(n)
      expect(appearing).toHaveLength(n)
    })

    it('lets the top seed win when the better seed always wins', () => {
      const seedOf = (id: ParticipantId) => participants.indexOf(id) + 1
      expect(playOut(fixture.matches, seedOf)).toBe('p1')
    })

    it('emits unique match ids', () => {
      expect(new Set(fixture.matches.map((m) => m.id)).size).toBe(fixture.matches.length)
    })

    it('references only earlier matches', () => {
      const seen = new Set<string>()
      const ordered = [...fixture.matches].sort((a, b) => a.round - b.round || a.order - b.order)

      for (const m of ordered) {
        for (const slot of [m.home, m.away]) {
          if (slot.kind === 'winnerOf' || slot.kind === 'loserOf') {
            expect(seen.has(slot.matchId), `${m.id} references ${slot.matchId}`).toBe(true)
          }
        }
        seen.add(m.id)
      }
    })
  })

  describe('bye placement', () => {
    it('gives byes to the top seeds', () => {
      // 12 in a 16 bracket → 4 byes, which must go to seeds 1-4.
      const fixture = generateSingleElimination(ids(12))
      const withBye = fixture.byes.map((b) => b.participantId).sort()

      expect(withBye).toEqual(['p1', 'p2', 'p3', 'p4'].sort())
    })

    it('gives no byes when the count is already a power of two', () => {
      expect(generateSingleElimination(ids(8)).byes).toHaveLength(0)
      expect(generateSingleElimination(ids(16)).byes).toHaveLength(0)
    })

    it('emits the bye match rather than omitting it', () => {
      const fixture = generateSingleElimination(ids(5))
      const byeMatches = fixture.matches.filter(
        (m) => m.home.kind === 'bye' || m.away.kind === 'bye',
      )

      // 5 in an 8 bracket → 3 byes, each shown on the draw sheet.
      expect(byeMatches).toHaveLength(3)
    })

    it('never pairs two byes against each other', () => {
      for (const n of [3, 5, 6, 7, 9, 11, 17, 23]) {
        const fixture = generateSingleElimination(ids(n))
        const doubleByes = fixture.matches.filter(
          (m) => m.home.kind === 'bye' && m.away.kind === 'bye',
        )
        expect(doubleByes, `${String(n)} participants`).toHaveLength(0)
      }
    })
  })

  describe('seeding fairness', () => {
    it('keeps seeds 1 and 2 apart until the final', () => {
      const participants = ids(16)
      const fixture = generateSingleElimination(participants)
      const finalMatch = fixture.matches.find((m) => m.label === 'round.final')

      const seedOf = (id: ParticipantId) => participants.indexOf(id) + 1
      const winners = new Map<string, ParticipantId>()
      const ordered = [...fixture.matches].sort((a, b) => a.round - b.round || a.order - b.order)

      const resolve = (slot: GeneratedMatch['home']): ParticipantId | null =>
        slot.kind === 'participant'
          ? slot.participantId
          : slot.kind === 'winnerOf'
            ? (winners.get(slot.matchId) ?? null)
            : null

      for (const m of ordered) {
        const home = resolve(m.home)
        const away = resolve(m.away)
        if (home && away) winners.set(m.id, seedOf(home) <= seedOf(away) ? home : away)
        else if (home) winners.set(m.id, home)
        else if (away) winners.set(m.id, away)
      }

      // Seed 2 must survive to the final when only seed 1 outranks them.
      expect(finalMatch).toBeDefined()
      const finalists = [resolve(finalMatch!.home), resolve(finalMatch!.away)].sort()
      expect(finalists).toEqual(['p1', 'p2'])
    })

    it('puts seed 1 against the weakest opponent in round one', () => {
      const fixture = generateSingleElimination(ids(8))
      const first = fixture.matches.find((m) => m.round === 1 && m.order === 1)

      expect(first?.home).toEqual({ kind: 'participant', participantId: 'p1' })
      expect(first?.away).toEqual({ kind: 'participant', participantId: 'p8' })
    })
  })

  describe('third place playoff', () => {
    it('adds a match between the two losing semi-finalists', () => {
      const fixture = generateSingleElimination(ids(8), { thirdPlace: true })
      const third = fixture.matches.find((m) => m.side === 'thirdPlace')

      expect(third).toBeDefined()
      expect(third?.home.kind).toBe('loserOf')
      expect(third?.away.kind).toBe('loserOf')
      expect(fixture.matches).toHaveLength(singleEliminationMatchCount(8, true))
    })

    it('is skipped with only two participants, since there are no semi-finals', () => {
      const fixture = generateSingleElimination(ids(2), { thirdPlace: true })
      expect(fixture.matches.filter((m) => m.side === 'thirdPlace')).toHaveLength(0)
    })

    it('draws on the two different semi-finals, not the same one twice', () => {
      const fixture = generateSingleElimination(ids(4), { thirdPlace: true })
      const third = fixture.matches.find((m) => m.side === 'thirdPlace')

      const home = third?.home
      const away = third?.away
      if (home?.kind !== 'loserOf' || away?.kind !== 'loserOf') throw new Error('expected loserOf')
      expect(home.matchId).not.toBe(away.matchId)
    })
  })

  describe('determinism', () => {
    it('produces identical output across runs', () => {
      expect(generateSingleElimination(ids(11))).toEqual(generateSingleElimination(ids(11)))
    })
  })

  describe('input validation', () => {
    it('rejects duplicates and tiny fields', () => {
      expect(() => generateSingleElimination(['a', 'a'])).toThrow(EngineError)
      expect(() => generateSingleElimination(['a'])).toThrow(EngineError)
    })
  })
})
