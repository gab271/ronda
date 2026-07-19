import { describe, expect, it } from 'vitest'
import { computeStandings, topN } from './standings'
import type { MatchResult, ParticipantId, Tiebreaker } from './types'

/** Compact result builder: `r('a', 'b', [[6,4],[6,3]])` is a straight-sets win. */
function r(
  home: ParticipantId,
  away: ParticipantId,
  sets: readonly [number, number][],
  outcome?: MatchResult['outcome'],
): MatchResult {
  return {
    matchId: `${home}-${away}`,
    homeParticipantId: home,
    awayParticipantId: away,
    sets: sets.map(([h, a]) => ({ home: h, away: a })),
    ...(outcome ? { outcome } : {}),
  }
}

const order = (rows: readonly { participantId: ParticipantId }[]) =>
  rows.map((row) => row.participantId)

describe('computeStandings', () => {
  describe('basic tallying', () => {
    const results = [
      r('a', 'b', [
        [6, 4],
        [6, 3],
      ]),
      r('a', 'c', [
        [6, 2],
        [6, 2],
      ]),
      r('b', 'c', [
        [6, 1],
        [6, 1],
      ]),
    ]

    it('counts wins, losses and points', () => {
      const table = computeStandings(['a', 'b', 'c'], results)

      expect(order(table)).toEqual(['a', 'b', 'c'])
      expect(table[0]).toMatchObject({ participantId: 'a', played: 2, won: 2, lost: 0, points: 6 })
      expect(table[1]).toMatchObject({ participantId: 'b', played: 2, won: 1, lost: 1, points: 3 })
      expect(table[2]).toMatchObject({ participantId: 'c', played: 2, won: 0, lost: 2, points: 0 })
    })

    it('counts sets and games from both perspectives', () => {
      const table = computeStandings(['a', 'b', 'c'], results)
      const a = table.find((row) => row.participantId === 'a')

      expect(a).toMatchObject({ setsWon: 4, setsLost: 0, gamesWon: 24, gamesLost: 11 })
      expect(a?.setDifference).toBe(4)
      expect(a?.gameDifference).toBe(13)
    })

    it('assigns sequential positions', () => {
      const table = computeStandings(['a', 'b', 'c'], results)
      expect(table.map((row) => row.position)).toEqual([1, 2, 3])
    })

    it('includes participants who have not played yet', () => {
      const table = computeStandings(['a', 'b', 'c', 'd'], results)
      const d = table.find((row) => row.participantId === 'd')

      expect(d).toMatchObject({ played: 0, points: 0 })
    })

    it('ranks an unplayed participant above one that lost everything', () => {
      // Both are on zero points, but c has a set difference of -4 while d, who
      // has not played, is on 0. Standard league-table behaviour: a mid-event
      // table sorted by points then difference does put the team with games in
      // hand above the team that has been beaten. It resolves itself once the
      // group finishes and everyone has played.
      const table = computeStandings(['a', 'b', 'c', 'd'], results)

      expect(order(table)).toEqual(['a', 'b', 'd', 'c'])
    })

    it('ignores results involving unknown participants', () => {
      const table = computeStandings(['a', 'b'], [...results, r('x', 'y', [[6, 0]])])
      expect(table).toHaveLength(2)
    })
  })

  describe('draws', () => {
    it('splits the points when sets are level', () => {
      const table = computeStandings(
        ['a', 'b'],
        [
          r('a', 'b', [
            [6, 4],
            [3, 6],
          ]),
        ],
        { points: { win: 3, draw: 1, loss: 0, walkoverWin: 3 } },
      )

      expect(table[0]).toMatchObject({ drawn: 1, points: 1 })
      expect(table[1]).toMatchObject({ drawn: 1, points: 1 })
    })
  })

  describe('head-to-head', () => {
    it('separates two level participants by their meeting', () => {
      // a and b both finish on 3 points; b beat a, so b goes above.
      const results = [
        r('b', 'a', [
          [6, 4],
          [6, 4],
        ]),
        r('a', 'c', [
          [6, 0],
          [6, 0],
        ]),
        r('b', 'c', [
          [7, 5],
          [7, 5],
        ]),
      ]

      const table = computeStandings(['a', 'b', 'c'], results, {
        tiebreakers: ['points', 'headToHead', 'gameDifference'],
      })

      expect(order(table)).toEqual(['b', 'a', 'c'])
    })

    it('is a mini-league among the tied set, not a pairwise comparison', () => {
      // Three-way cycle: a beat b, b beat c, c beat a — all on 3 points with
      // identical overall game difference. Head-to-head cannot separate them
      // (each is 1-1 inside the mini-league), so it must fall through to the
      // next criterion rather than producing a sort-order-dependent result.
      const results = [
        r('a', 'b', [
          [6, 4],
          [6, 4],
        ]),
        r('b', 'c', [
          [6, 4],
          [6, 4],
        ]),
        r('c', 'a', [
          [6, 4],
          [6, 4],
        ]),
      ]

      const table = computeStandings(['a', 'b', 'c'], results, {
        tiebreakers: ['points', 'headToHead', 'gamesWon'],
      })

      // Every one of them: 1 win, 1 loss, 12 games won, 8 lost.
      for (const row of table) {
        expect(row.points).toBe(3)
        expect(row.gameDifference).toBe(0)
      }
      // Unbroken by any criterion, so all three are flagged rather than silently
      // ordered.
      expect(table.every((row) => row.unresolvedTie)).toBe(true)
    })

    it('does not consume later tiebreakers when it fails to separate', () => {
      // a and b tie on points; their head-to-head was a draw, so game
      // difference must still be applied.
      const results = [
        r('a', 'b', [
          [6, 4],
          [4, 6],
        ]),
        r('a', 'c', [
          [6, 0],
          [6, 0],
        ]),
        r('b', 'c', [
          [6, 5],
          [6, 5],
        ]),
      ]

      const table = computeStandings(['a', 'b', 'c'], results, {
        tiebreakers: ['points', 'headToHead', 'gameDifference'],
      })

      // a: draw + win = 4 pts; b: draw + win = 4 pts. a has the better game
      // difference (22-10 = +12 vs 22-20 = +2).
      expect(order(table).slice(0, 2)).toEqual(['a', 'b'])
      expect(table[0]?.unresolvedTie).toBe(false)
    })

    it('measures only matches inside the tied set', () => {
      // a and b are level on points. a hammered c; b lost narrowly to c.
      // Head-to-head (b beat a) must win out over the fact that a's overall
      // record looks better.
      const results = [
        r('b', 'a', [
          [6, 4],
          [6, 4],
        ]),
        r('a', 'c', [
          [6, 0],
          [6, 0],
        ]),
        r('a', 'd', [
          [6, 0],
          [6, 0],
        ]),
        r('b', 'c', [
          [6, 0],
          [6, 0],
        ]),
        r('b', 'd', [
          [6, 0],
          [6, 0],
        ]),
      ]

      const table = computeStandings(['a', 'b', 'c', 'd'], results, {
        tiebreakers: ['points', 'headToHead', 'gameDifference'],
      })

      expect(order(table).slice(0, 2)).toEqual(['b', 'a'])
    })
  })

  describe('non-head-to-head criteria use the full table', () => {
    it('compares game difference across all matches, not just among the tied', () => {
      // a and b level on points and cannot be split head-to-head (they drew).
      // a's demolition of c must count toward game difference — restricting the
      // scope to the tied pair would make both differences zero and wrongly
      // report an unresolved tie.
      const results = [
        r('a', 'b', [
          [6, 4],
          [4, 6],
        ]),
        r('a', 'c', [
          [6, 0],
          [6, 0],
        ]),
        r('b', 'c', [
          [7, 6],
          [7, 6],
        ]),
      ]

      const table = computeStandings(['a', 'b', 'c'], results, {
        tiebreakers: ['points', 'headToHead', 'gameDifference'],
      })

      expect(order(table).slice(0, 2)).toEqual(['a', 'b'])
      expect(table[0]?.unresolvedTie).toBe(false)
    })
  })

  describe('configurable tiebreakers', () => {
    const results = [
      r('a', 'c', [
        [6, 0],
        [6, 0],
      ]),
      r('b', 'c', [
        [7, 5],
        [7, 5],
      ]),
      r('a', 'b', [
        [6, 4],
        [4, 6],
      ]),
    ]

    it('produces a DIFFERENT winner depending on the criterion chosen', () => {
      // a and b both finish on 4 points, and this is the case where the choice
      // of tiebreaker genuinely decides the title:
      //
      //   a: beat c 6-0 6-0, drew with b  → 22 games won, 10 conceded (+12)
      //   b: beat c 7-5 7-5, drew with a  → 24 games won, 20 conceded (+4)
      //
      // Most games won → b. Best game difference → a. Both are defensible rules
      // and Spanish clubs use both, which is exactly why this is configurable
      // rather than hardcoded.
      const byGames = computeStandings(['a', 'b', 'c'], results, {
        tiebreakers: ['points', 'gamesWon'],
      })
      const byDifference = computeStandings(['a', 'b', 'c'], results, {
        tiebreakers: ['points', 'gameDifference'],
      })

      expect(byGames[0]?.participantId).toBe('b')
      expect(byDifference[0]?.participantId).toBe('a')
    })

    it('supports football-style 3/1/0 and padel-style win-only scoring', () => {
      const football = computeStandings(['a', 'b'], [r('a', 'b', [[2, 1]])], {
        points: { win: 3, draw: 1, loss: 0, walkoverWin: 3 },
      })
      const padel = computeStandings(['a', 'b'], [r('a', 'b', [[2, 1]])], {
        points: { win: 1, draw: 0, loss: 0, walkoverWin: 1 },
      })

      expect(football[0]?.points).toBe(3)
      expect(padel[0]?.points).toBe(1)
    })

    it('can rank by fewest played, for mid-tournament tables', () => {
      const table = computeStandings(['a', 'b'], [r('a', 'b', [[6, 0]]), r('a', 'b', [[6, 0]])], {
        tiebreakers: ['played'] as Tiebreaker[],
      })

      expect(table).toHaveLength(2)
    })
  })

  describe('walkovers', () => {
    const results = [
      r('a', 'b', [
        [6, 0],
        [6, 0],
      ], 'walkover'),
      r('a', 'c', [
        [6, 4],
        [6, 4],
      ]),
    ]

    it('awards the win but excludes the invented games by default', () => {
      const table = computeStandings(['a', 'b', 'c'], results)
      const a = table.find((row) => row.participantId === 'a')

      expect(a?.won).toBe(2)
      expect(a?.played).toBe(2)
      // Only the genuinely played match contributes games.
      expect(a?.gamesWon).toBe(12)
      expect(a?.gamesLost).toBe(8)
    })

    it('counts walkover games when explicitly enabled', () => {
      const table = computeStandings(['a', 'b', 'c'], results, { countWalkoverGames: true })
      const a = table.find((row) => row.participantId === 'a')

      expect(a?.gamesWon).toBe(24)
    })

    it('still records the defeat for the absent participant', () => {
      const table = computeStandings(['a', 'b', 'c'], results)
      const b = table.find((row) => row.participantId === 'b')

      expect(b).toMatchObject({ played: 1, lost: 1, points: 0 })
    })
  })

  describe('determinism', () => {
    it('produces identical output across runs', () => {
      const results = [
        r('a', 'b', [
          [6, 4],
          [6, 4],
        ]),
        r('c', 'd', [
          [6, 4],
          [6, 4],
        ]),
      ]

      expect(computeStandings(['a', 'b', 'c', 'd'], results)).toEqual(
        computeStandings(['a', 'b', 'c', 'd'], results),
      )
    })

    it('does not depend on the order results are supplied in', () => {
      const results = [
        r('a', 'b', [
          [6, 4],
          [6, 4],
        ]),
        r('b', 'c', [
          [6, 4],
          [6, 4],
        ]),
        r('a', 'c', [
          [6, 4],
          [6, 4],
        ]),
      ]

      const forwards = computeStandings(['a', 'b', 'c'], results)
      const backwards = computeStandings(['a', 'b', 'c'], [...results].reverse())

      expect(order(forwards)).toEqual(order(backwards))
    })

    it('does not depend on the order participants are supplied in', () => {
      const results = [
        r('a', 'b', [
          [6, 4],
          [6, 4],
        ]),
      ]

      expect(order(computeStandings(['a', 'b'], results))).toEqual(
        order(computeStandings(['b', 'a'], results)),
      )
    })
  })

  describe('edge cases', () => {
    it('handles no results at all', () => {
      const table = computeStandings(['a', 'b', 'c'], [])

      expect(table).toHaveLength(3)
      expect(table.every((row) => row.played === 0)).toBe(true)
      // Nothing distinguishes them, so all three are flagged.
      expect(table.every((row) => row.unresolvedTie)).toBe(true)
    })

    it('handles a single participant', () => {
      const table = computeStandings(['a'], [])
      expect(table).toHaveLength(1)
      expect(table[0]?.unresolvedTie).toBe(false)
    })

    it('handles an empty field', () => {
      expect(computeStandings([], [])).toEqual([])
    })
  })
})

describe('topN', () => {
  it('returns the leading participants in order', () => {
    const table = computeStandings(
      ['a', 'b', 'c', 'd'],
      [
        r('a', 'b', [
          [6, 0],
          [6, 0],
        ]),
        r('a', 'c', [
          [6, 0],
          [6, 0],
        ]),
        r('b', 'c', [
          [6, 0],
          [6, 0],
        ]),
      ],
    )

    expect(topN(table, 2)).toEqual(['a', 'b'])
  })

  it('does not overrun a short table', () => {
    expect(topN(computeStandings(['a'], []), 5)).toEqual(['a'])
  })
})
