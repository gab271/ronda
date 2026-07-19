import { describe, expect, it } from 'vitest'
import {
  maxSwissRounds,
  pairSwissRound,
  playedPairs,
  suggestedSwissRounds,
} from './swiss'
import { EngineError, type MatchResult, type ParticipantId } from './types'

function ids(n: number): ParticipantId[] {
  return Array.from({ length: n }, (_, i) => `p${String(i + 1)}`)
}

const key = (a: ParticipantId, b: ParticipantId) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Runs a whole Swiss event. The better seed always wins, which is the harshest
 * case for pairing: scores cluster hard, so the pool of legal opponents at each
 * score level shrinks fastest.
 */
function runSwiss(participants: readonly ParticipantId[], rounds: number) {
  const results: MatchResult[] = []
  const byes: ParticipantId[] = []
  const perRound: { round: number; pairs: string[]; bye: ParticipantId | null }[] = []

  for (let round = 1; round <= rounds; round += 1) {
    const swissRound = pairSwissRound(participants, results, round, { previousByes: byes })
    const pairs: string[] = []

    for (const match of swissRound.matches) {
      if (match.home.kind !== 'participant' || match.away.kind !== 'participant') continue
      const home = match.home.participantId
      const away = match.away.participantId
      pairs.push(key(home, away))

      const winner = participants.indexOf(home) <= participants.indexOf(away) ? home : away
      results.push({
        matchId: match.id,
        homeParticipantId: home,
        awayParticipantId: away,
        sets: winner === home ? [{ home: 6, away: 3 }] : [{ home: 3, away: 6 }],
      })
    }

    if (swissRound.bye) byes.push(swissRound.bye)
    perRound.push({ round, pairs, bye: swissRound.bye })
  }

  return { results, byes, perRound }
}

describe('pairSwissRound', () => {
  describe('round one', () => {
    it('pairs everyone exactly once', () => {
      const round = pairSwissRound(ids(8), [], 1)

      expect(round.matches).toHaveLength(4)
      expect(round.bye).toBeNull()

      const appearing = round.matches.flatMap((m) =>
        m.home.kind === 'participant' && m.away.kind === 'participant'
          ? [m.home.participantId, m.away.participantId]
          : [],
      )
      expect(new Set(appearing).size).toBe(8)
    })

    it('gives a bye with an odd field', () => {
      const round = pairSwissRound(ids(7), [], 1)

      expect(round.matches).toHaveLength(3)
      expect(round.bye).not.toBeNull()
    })
  })

  describe('no repeat opponents', () => {
    it.each([
      [8, 3],
      [8, 5],
      [16, 4],
      [12, 4],
      [6, 5],
      [10, 5],
      [32, 5],
    ])('never repeats a pairing over %i participants and %i rounds', (n, rounds) => {
      const { perRound } = runSwiss(ids(n), rounds)
      const seen = new Set<string>()

      for (const { round, pairs } of perRound) {
        for (const pair of pairs) {
          expect(seen.has(pair), `round ${String(round)} repeats ${pair}`).toBe(false)
          seen.add(pair)
        }
      }
    })

    it('survives the case a greedy pairing would fail', () => {
      // Four participants, three rounds: the last round has exactly one legal
      // pairing left. A greedy sweep down the table picks the wrong pair in
      // round three and gets stuck; backtracking finds the only valid answer.
      const participants = ids(4)
      const { perRound } = runSwiss(participants, 3)

      const allPairs = perRound.flatMap((r) => r.pairs)
      expect(new Set(allPairs).size).toBe(6) // every pair exactly once
    })

    it('runs a full round robin when rounds equal n-1', () => {
      const { perRound } = runSwiss(ids(6), 5)
      const allPairs = perRound.flatMap((r) => r.pairs)

      // 6 participants → 15 distinct pairs, all of them used.
      expect(new Set(allPairs).size).toBe(15)
      expect(allPairs).toHaveLength(15)
    })
  })

  describe('pairing by score', () => {
    it('pairs the leaders together in round two', () => {
      const participants = ids(8)
      const round1 = pairSwissRound(participants, [], 1)

      // Everyone in the top half wins.
      const results: MatchResult[] = round1.matches.map((m) => {
        const home = m.home.kind === 'participant' ? m.home.participantId : ''
        const away = m.away.kind === 'participant' ? m.away.participantId : ''
        const winner = participants.indexOf(home) <= participants.indexOf(away) ? home : away
        return {
          matchId: m.id,
          homeParticipantId: home,
          awayParticipantId: away,
          sets: winner === home ? [{ home: 6, away: 0 }] : [{ home: 0, away: 6 }],
        }
      })

      const winners = new Set(
        results.map((r) =>
          participants.indexOf(r.homeParticipantId) <= participants.indexOf(r.awayParticipantId)
            ? r.homeParticipantId
            : r.awayParticipantId,
        ),
      )

      const round2 = pairSwissRound(participants, results, 2)

      // Every round-two match should be winner-vs-winner or loser-vs-loser.
      for (const m of round2.matches) {
        if (m.home.kind !== 'participant' || m.away.kind !== 'participant') continue
        const homeWon = winners.has(m.home.participantId)
        const awayWon = winners.has(m.away.participantId)
        expect(homeWon, `${m.home.participantId} vs ${m.away.participantId}`).toBe(awayWon)
      }
    })
  })

  describe('byes', () => {
    it('never gives the same participant two byes while others have none', () => {
      const { perRound } = runSwiss(ids(7), 5)
      const byes = perRound.map((r) => r.bye).filter((b): b is ParticipantId => b !== null)

      expect(byes).toHaveLength(5)
      expect(new Set(byes).size).toBe(5)
    })

    it('gives the bye to a participant who has not had one', () => {
      const round = pairSwissRound(ids(5), [], 2, { previousByes: ['p5'] })
      expect(round.bye).not.toBe('p5')
    })

    it('falls back gracefully once everyone has rested', () => {
      // 3 participants, everyone has already had a bye — must still pair.
      const round = pairSwissRound(ids(3), [], 4, { previousByes: ids(3) })

      expect(round.bye).not.toBeNull()
      expect(round.matches).toHaveLength(1)
    })

    it('prefers a lower-ranked participant for the bye', () => {
      const participants = ids(5)
      // p1 and p2 have wins; the bye should not go to them.
      const results: MatchResult[] = [
        {
          matchId: 'm1',
          homeParticipantId: 'p1',
          awayParticipantId: 'p3',
          sets: [{ home: 6, away: 0 }],
        },
        {
          matchId: 'm2',
          homeParticipantId: 'p2',
          awayParticipantId: 'p4',
          sets: [{ home: 6, away: 0 }],
        },
      ]

      const round = pairSwissRound(participants, results, 2)
      expect(['p1', 'p2']).not.toContain(round.bye)
    })
  })

  describe('when no pairing is possible', () => {
    it('reports it rather than emitting a rematch', () => {
      // 4 participants, all 6 pairs already played. Round 4 is impossible.
      const participants = ids(4)
      const results: MatchResult[] = []
      let n = 0
      for (let i = 0; i < 4; i += 1) {
        for (let j = i + 1; j < 4; j += 1) {
          n += 1
          results.push({
            matchId: `m${String(n)}`,
            homeParticipantId: participants[i]!,
            awayParticipantId: participants[j]!,
            sets: [{ home: 6, away: 0 }],
          })
        }
      }

      expect(() => pairSwissRound(participants, results, 4)).toThrow(EngineError)
      expect(() => pairSwissRound(participants, results, 4)).toThrow(/too small/)
    })
  })

  describe('determinism', () => {
    it('produces identical pairings across runs', () => {
      expect(pairSwissRound(ids(12), [], 1)).toEqual(pairSwissRound(ids(12), [], 1))
    })

    it('produces identical full events across runs', () => {
      expect(runSwiss(ids(10), 4).perRound).toEqual(runSwiss(ids(10), 4).perRound)
    })
  })

  describe('input validation', () => {
    it('rejects duplicates and single-participant fields', () => {
      expect(() => pairSwissRound(['a', 'a'], [], 1)).toThrow(EngineError)
      expect(() => pairSwissRound(['a'], [], 1)).toThrow(EngineError)
    })
  })
})

describe('playedPairs', () => {
  it('is order-independent', () => {
    const pairs = playedPairs([
      { matchId: 'm', homeParticipantId: 'b', awayParticipantId: 'a', sets: [] },
    ])

    expect(pairs.has('a|b')).toBe(true)
  })
})

describe('round count helpers', () => {
  it('caps rounds at n-1', () => {
    expect(maxSwissRounds(8)).toBe(7)
    expect(maxSwissRounds(2)).toBe(1)
    expect(maxSwissRounds(1)).toBe(0)
  })

  it('suggests ceil(log2(n)) rounds', () => {
    expect(suggestedSwissRounds(8)).toBe(3)
    expect(suggestedSwissRounds(16)).toBe(4)
    expect(suggestedSwissRounds(12)).toBe(4)
    expect(suggestedSwissRounds(1)).toBe(0)
  })
})
