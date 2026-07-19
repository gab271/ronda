import { describe, expect, it } from 'vitest'
import { generateDoubleElimination, doubleEliminationMatchCount } from './doubleElimination'
import { countLosses, orderForResolution, simulateBracket } from './resolve'
import { EngineError, type ParticipantId } from './types'

function ids(n: number): ParticipantId[] {
  return Array.from({ length: n }, (_, i) => `p${String(i + 1)}`)
}

/** Better seed (lower index) always wins. */
const bySeed =
  (participants: readonly ParticipantId[]) => (home: ParticipantId, away: ParticipantId) =>
    participants.indexOf(home) <= participants.indexOf(away) ? home : away

describe('generateDoubleElimination', () => {
  describe.each([4, 8, 16, 32])('with %i participants (full bracket)', (n) => {
    const participants = ids(n)
    const fixture = generateDoubleElimination(participants)

    it('emits 2n-2 matches plus the grand final decider', () => {
      expect(fixture.matches).toHaveLength(doubleEliminationMatchCount(n))
      // Cross-check the formula against first principles: every participant
      // except the champion must lose twice.
      expect(doubleEliminationMatchCount(n, false)).toBe(2 * n - 2)
    })

    it('has one winners final, one losers final and one grand final', () => {
      const labels = fixture.matches.map((m) => m.label)
      expect(labels.filter((l) => l === 'round.winnersFinal')).toHaveLength(1)
      expect(labels.filter((l) => l === 'round.losersFinal')).toHaveLength(1)
      expect(labels.filter((l) => l === 'round.grandFinal')).toHaveLength(1)
    })

    it('gives the winners bracket log2(n) rounds', () => {
      const wbRounds = new Set(
        fixture.matches.filter((m) => m.side === 'winners').map((m) => m.round),
      )
      expect(wbRounds.size).toBe(Math.log2(n))
    })

    it('gives the losers bracket 2(log2(n)-1) rounds', () => {
      const lbRounds = new Set(
        fixture.matches.filter((m) => m.side === 'losers').map((m) => m.round),
      )
      expect(lbRounds.size).toBe(2 * (Math.log2(n) - 1))
    })

    it('is a DAG that can be topologically ordered', () => {
      expect(() => orderForResolution(fixture.matches)).not.toThrow()
      expect(orderForResolution(fixture.matches)).toHaveLength(fixture.matches.length)
    })

    it('references only matches that exist', () => {
      const known = new Set(fixture.matches.map((m) => m.id))
      for (const m of fixture.matches) {
        for (const slot of [m.home, m.away]) {
          if (slot.kind === 'winnerOf' || slot.kind === 'loserOf') {
            expect(known.has(slot.matchId), `${m.id} → ${slot.matchId}`).toBe(true)
          }
        }
      }
    })

    it('lets the top seed win when the better seed always wins', () => {
      const outcomes = simulateBracket(fixture.matches, bySeed(participants))
      const grandFinal = fixture.matches.find((m) => m.label === 'round.grandFinal')

      expect(outcomes.get(grandFinal!.id)?.winner).toBe('p1')
    })

    it('eliminates nobody before their second defeat', () => {
      // THE defining property of double elimination. Simulating and counting
      // losses tests the actual invariant rather than the bracket's shape.
      const outcomes = simulateBracket(fixture.matches, bySeed(participants))
      const losses = countLosses(outcomes)

      // Everyone except the champion loses exactly twice; the champion, coming
      // through the winners bracket, loses zero times.
      expect(losses.get('p1') ?? 0).toBe(0)

      for (const id of participants.slice(1)) {
        expect(losses.get(id) ?? 0, `${id} loss count`).toBe(2)
      }
    })

    it('never has a participant lose three times', () => {
      // Reverse decision function: the WORSE seed always wins. A different
      // traversal of the same bracket, so it exercises different paths.
      const outcomes = simulateBracket(fixture.matches, (home, away) =>
        participants.indexOf(home) > participants.indexOf(away) ? home : away,
      )

      for (const [id, count] of countLosses(outcomes)) {
        expect(count, `${id} lost ${String(count)} times`).toBeLessThanOrEqual(2)
      }
    })
  })

  describe('losers bracket structure', () => {
    it('feeds losers-bracket round 1 entirely from winners-bracket round 1', () => {
      const fixture = generateDoubleElimination(ids(8))
      const lb1 = fixture.matches.filter((m) => m.side === 'losers' && m.round === 1)

      expect(lb1).toHaveLength(2)
      for (const m of lb1) {
        expect(m.home.kind).toBe('loserOf')
        expect(m.away.kind).toBe('loserOf')
      }
    })

    it('alternates consolidation and drop-in rounds', () => {
      const fixture = generateDoubleElimination(ids(16))

      for (const round of [2, 4, 6]) {
        const dropIn = fixture.matches.filter((m) => m.side === 'losers' && m.round === round)
        for (const m of dropIn) {
          // Drop-in: a survivor (winnerOf) meets a fresh WB loser (loserOf).
          expect(m.home.kind, `losers round ${String(round)}`).toBe('winnerOf')
          expect(m.away.kind, `losers round ${String(round)}`).toBe('loserOf')
        }
      }

      for (const round of [3, 5]) {
        const consolidation = fixture.matches.filter(
          (m) => m.side === 'losers' && m.round === round,
        )
        for (const m of consolidation) {
          expect(m.home.kind, `losers round ${String(round)}`).toBe('winnerOf')
          expect(m.away.kind, `losers round ${String(round)}`).toBe('winnerOf')
        }
      }
    })

    it('reverses drop-in order to delay rematches', () => {
      const fixture = generateDoubleElimination(ids(16))
      const lb2 = fixture.matches
        .filter((m) => m.side === 'losers' && m.round === 2)
        .sort((a, b) => a.order - b.order)

      const droppedFrom = lb2.map((m) => (m.away.kind === 'loserOf' ? m.away.matchId : ''))
      const wb2 = fixture.matches
        .filter((m) => m.side === 'winners' && m.round === 2)
        .sort((a, b) => a.order - b.order)
        .map((m) => m.id)

      // Reversed, not in natural order — this is the anti-rematch measure.
      expect(droppedFrom).toEqual([...wb2].reverse())
    })
  })

  describe('grand final', () => {
    it('pits the winners-bracket winner against the losers-bracket winner', () => {
      const fixture = generateDoubleElimination(ids(8))
      const gf = fixture.matches.find((m) => m.label === 'round.grandFinal')
      const wbFinal = fixture.matches.find((m) => m.label === 'round.winnersFinal')
      const lbFinal = fixture.matches.find((m) => m.label === 'round.losersFinal')

      expect(gf?.home).toEqual({ kind: 'winnerOf', matchId: wbFinal?.id })
      expect(gf?.away).toEqual({ kind: 'winnerOf', matchId: lbFinal?.id })
    })

    it('adds a decider by default', () => {
      const fixture = generateDoubleElimination(ids(8))
      expect(fixture.matches.some((m) => m.label === 'round.grandFinalReset')).toBe(true)
    })

    it('omits the decider when disabled', () => {
      const fixture = generateDoubleElimination(ids(8), { grandFinalReset: false })

      expect(fixture.matches.some((m) => m.label === 'round.grandFinalReset')).toBe(false)
      expect(fixture.matches).toHaveLength(doubleEliminationMatchCount(8, false))
    })

    it('gives the losers-bracket finalist a second chance in the decider', () => {
      // Without a reset, the winners-bracket finalist would go out on one defeat,
      // which contradicts the format.
      const fixture = generateDoubleElimination(ids(8))
      const gf = fixture.matches.find((m) => m.label === 'round.grandFinal')
      const reset = fixture.matches.find((m) => m.label === 'round.grandFinalReset')

      expect(reset?.home).toEqual({ kind: 'winnerOf', matchId: gf?.id })
      expect(reset?.away).toEqual({ kind: 'loserOf', matchId: gf?.id })
    })
  })

  describe('non-power-of-two fields', () => {
    it.each([5, 6, 7, 9, 11, 13])('handles %i participants with byes', (n) => {
      const participants = ids(n)
      const fixture = generateDoubleElimination(participants)
      const outcomes = simulateBracket(fixture.matches, bySeed(participants))
      const gf = fixture.matches.find((m) => m.label === 'round.grandFinal')

      expect(outcomes.get(gf!.id)?.winner).toBe('p1')
    })

    it('still eliminates nobody before two real defeats', () => {
      const participants = ids(6)
      const fixture = generateDoubleElimination(participants)
      const outcomes = simulateBracket(fixture.matches, bySeed(participants))

      for (const [id, count] of countLosses(outcomes)) {
        expect(count, `${id}`).toBeLessThanOrEqual(2)
      }
    })

    it('gives byes to the top seeds', () => {
      const fixture = generateDoubleElimination(ids(6))
      expect(fixture.byes.map((b) => b.participantId).sort()).toEqual(['p1', 'p2'])
    })
  })

  describe('determinism', () => {
    it('produces identical output across runs', () => {
      expect(generateDoubleElimination(ids(8))).toEqual(generateDoubleElimination(ids(8)))
    })

    it('emits unique match ids', () => {
      const fixture = generateDoubleElimination(ids(16))
      expect(new Set(fixture.matches.map((m) => m.id)).size).toBe(fixture.matches.length)
    })
  })

  describe('input validation', () => {
    it('requires at least four participants', () => {
      expect(() => generateDoubleElimination(ids(3))).toThrow(EngineError)
      expect(() => generateDoubleElimination(ids(3))).toThrow(/at least 4/)
    })

    it('rejects duplicates', () => {
      expect(() => generateDoubleElimination(['a', 'b', 'c', 'a'])).toThrow(EngineError)
    })
  })
})
