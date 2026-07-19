import { describe, expect, it } from 'vitest'
import {
  generateRoundRobin,
  roundRobinMatchCount,
  roundRobinRoundCount,
} from './roundRobin'
import { EngineError, type GeneratedMatch, type ParticipantId } from './types'

function ids(n: number): ParticipantId[] {
  return Array.from({ length: n }, (_, i) => `p${String(i + 1)}`)
}

/** Every unordered pair present in the fixture, as "a|b" with a < b. */
function pairKeys(matches: readonly GeneratedMatch[]): string[] {
  return matches.map((m) => {
    if (m.home.kind !== 'participant' || m.away.kind !== 'participant') {
      throw new Error('round robin should only emit concrete participants')
    }
    return [m.home.participantId, m.away.participantId].sort().join('|')
  })
}

describe('generateRoundRobin', () => {
  describe.each([2, 3, 4, 5, 6, 7, 8, 9, 12, 16])('with %i participants', (n) => {
    const participants = ids(n)
    const fixture = generateRoundRobin(participants)

    it('plays every pair exactly once', () => {
      const keys = pairKeys(fixture.matches)
      const unique = new Set(keys)

      expect(keys.length).toBe(unique.size)
      expect(unique.size).toBe((n * (n - 1)) / 2)
    })

    it('never schedules a participant twice in the same round', () => {
      const byRound = new Map<number, ParticipantId[]>()
      for (const m of fixture.matches) {
        if (m.home.kind !== 'participant' || m.away.kind !== 'participant') continue
        const list = byRound.get(m.round) ?? []
        list.push(m.home.participantId, m.away.participantId)
        byRound.set(m.round, list)
      }

      for (const [round, appearing] of byRound) {
        expect(new Set(appearing).size, `round ${String(round)} has a double booking`).toBe(
          appearing.length,
        )
      }
    })

    it('uses the expected number of rounds', () => {
      const roundNumbers = new Set(fixture.matches.map((m) => m.round))
      expect(roundNumbers.size).toBe(roundRobinRoundCount(n))
    })

    it('agrees with roundRobinMatchCount', () => {
      expect(fixture.matches.length).toBe(roundRobinMatchCount(n))
    })

    it('emits unique match ids', () => {
      const idSet = new Set(fixture.matches.map((m) => m.id))
      expect(idSet.size).toBe(fixture.matches.length)
    })
  })

  describe('odd participant counts', () => {
    it('gives every participant exactly one bye with 5 players', () => {
      const fixture = generateRoundRobin(ids(5))

      expect(fixture.byes).toHaveLength(5)
      expect(new Set(fixture.byes.map((b) => b.participantId)).size).toBe(5)
    })

    it('gives no byes with an even count', () => {
      expect(generateRoundRobin(ids(6)).byes).toHaveLength(0)
    })

    it('never puts two byes in the same round', () => {
      const fixture = generateRoundRobin(ids(7))
      const rounds = fixture.byes.map((b) => b.round)

      expect(new Set(rounds).size).toBe(rounds.length)
    })
  })

  describe('double legs', () => {
    it('plays every pair exactly twice', () => {
      const fixture = generateRoundRobin(ids(4), { legs: 2 })
      const counts = new Map<string, number>()

      for (const key of pairKeys(fixture.matches)) {
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }

      expect(counts.size).toBe(6)
      for (const [pair, count] of counts) {
        expect(count, `pair ${pair}`).toBe(2)
      }
    })

    it('reverses home and away between the two legs', () => {
      const fixture = generateRoundRobin(ids(4), { legs: 2 })
      const orientations = new Map<string, string[]>()

      for (const m of fixture.matches) {
        if (m.home.kind !== 'participant' || m.away.kind !== 'participant') continue
        const key = [m.home.participantId, m.away.participantId].sort().join('|')
        const list = orientations.get(key) ?? []
        list.push(`${m.home.participantId}>${m.away.participantId}`)
        orientations.set(key, list)
      }

      for (const [pair, sides] of orientations) {
        expect(sides[0], `pair ${pair} played the same way twice`).not.toBe(sides[1])
      }
    })
  })

  describe('home/away balance', () => {
    it('does not give any participant every match at home', () => {
      const fixture = generateRoundRobin(ids(8))
      const homeCounts = new Map<ParticipantId, number>()

      for (const m of fixture.matches) {
        if (m.home.kind !== 'participant') continue
        homeCounts.set(m.home.participantId, (homeCounts.get(m.home.participantId) ?? 0) + 1)
      }

      // With 8 participants each plays 7 matches; a fair spread is 3 or 4 home.
      // The naive circle method would give the fixed participant 7 or 0.
      for (const [id, count] of homeCounts) {
        expect(count, `${id} home matches`).toBeGreaterThan(1)
        expect(count, `${id} home matches`).toBeLessThan(6)
      }
    })
  })

  describe('determinism', () => {
    it('produces identical output across runs', () => {
      expect(generateRoundRobin(ids(9))).toEqual(generateRoundRobin(ids(9)))
    })
  })

  describe('input validation', () => {
    it('rejects duplicate participants', () => {
      expect(() => generateRoundRobin(['a', 'b', 'a'])).toThrow(EngineError)
    })

    it('rejects fewer than two participants', () => {
      expect(() => generateRoundRobin(['a'])).toThrow(EngineError)
    })

    it('names the offending participant', () => {
      expect(() => generateRoundRobin(['a', 'a'])).toThrow(/"a"/)
    })
  })
})

describe('roundRobinMatchCount', () => {
  it.each([
    [2, 1, 1],
    [4, 1, 6],
    [8, 1, 28],
    [16, 1, 120],
    [4, 2, 12],
  ])('%i participants over %i leg(s) is %i matches', (n, legs, expected) => {
    expect(roundRobinMatchCount(n, legs as 1 | 2)).toBe(expected)
  })

  it('is zero below two participants', () => {
    expect(roundRobinMatchCount(1)).toBe(0)
    expect(roundRobinMatchCount(0)).toBe(0)
  })
})
