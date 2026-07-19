import { describe, expect, it } from 'vitest'
import {
  assignGroups,
  generateGroupsToKnockout,
  groupLabel,
  resolveGroupQualifiers,
  resolveGroupSlot,
  seedQualifierSlots,
} from './groups'
import { EngineError, type MatchResult, type ParticipantId } from './types'

function ids(n: number): ParticipantId[] {
  return Array.from({ length: n }, (_, i) => `p${String(i + 1)}`)
}

describe('groupLabel', () => {
  it('uses letters', () => {
    expect(groupLabel(0)).toBe('A')
    expect(groupLabel(3)).toBe('D')
    expect(groupLabel(25)).toBe('Z')
  })
})

describe('assignGroups', () => {
  it('splits evenly when the field divides', () => {
    const groups = assignGroups(ids(16), 4)

    expect(groups).toHaveLength(4)
    for (const group of groups) {
      expect(group.participantIds).toHaveLength(4)
    }
  })

  it('uses serpentine order so groups are balanced', () => {
    const groups = assignGroups(ids(16), 4)

    // A: 1, 8, 9, 16 — the strongest seed paired with the weakest.
    expect(groups[0]?.participantIds).toEqual(['p1', 'p8', 'p9', 'p16'])
    expect(groups[1]?.participantIds).toEqual(['p2', 'p7', 'p10', 'p15'])
    expect(groups[2]?.participantIds).toEqual(['p3', 'p6', 'p11', 'p14'])
    expect(groups[3]?.participantIds).toEqual(['p4', 'p5', 'p12', 'p13'])
  })

  it('balances total seed strength across groups', () => {
    const groups = assignGroups(ids(16), 4)
    const strength = groups.map((g) =>
      g.participantIds.reduce((sum, id) => sum + Number(id.slice(1)), 0),
    )

    // Straight dealing would give 1+2+3+4=10 vs 13+14+15+16=58. Serpentine
    // makes every group identical here.
    expect(new Set(strength).size).toBe(1)
  })

  it('handles a field that does not divide evenly', () => {
    // Which group gets the spare is an artefact of where the serpentine happens
    // to turn, and is not meaningful. What matters is that no group is more than
    // one participant larger than another — a group of 5 alongside a group of 3
    // would mean wildly different match counts for the same qualification.
    for (const [n, groupCount] of [
      [10, 3],
      [11, 4],
      [17, 4],
      [23, 6],
      [7, 2],
    ] as const) {
      const groups = assignGroups(ids(n), groupCount)
      const sizes = groups.map((g) => g.participantIds.length)

      expect(sizes.reduce((a, b) => a + b, 0), `${String(n)} in ${String(groupCount)}`).toBe(n)
      expect(
        Math.max(...sizes) - Math.min(...sizes),
        `${String(n)} in ${String(groupCount)} → ${sizes.join(',')}`,
      ).toBeLessThanOrEqual(1)
    }
  })

  it('places every participant exactly once', () => {
    const groups = assignGroups(ids(23), 4)
    const all = groups.flatMap((g) => g.participantIds)

    expect(new Set(all).size).toBe(23)
  })
})

describe('seedQualifierSlots', () => {
  it('never pairs two qualifiers from the same group in round one', () => {
    for (const groupCount of [2, 4, 8]) {
      const slots = seedQualifierSlots(groupCount, 2)

      for (let i = 0; i < slots.length; i += 2) {
        const home = slots[i]
        const away = slots[i + 1]
        if (home?.kind !== 'groupPosition' || away?.kind !== 'groupPosition') continue

        expect(
          home.group,
          `${String(groupCount)} groups: ${home.group}${String(home.position)} vs ${away.group}${String(away.position)}`,
        ).not.toBe(away.group)
      }
    }
  })

  it('pairs each group winner with the next group runner-up', () => {
    const slots = seedQualifierSlots(4, 2)
    const pairs: string[] = []

    for (let i = 0; i < slots.length; i += 2) {
      const home = slots[i]
      const away = slots[i + 1]
      if (home?.kind !== 'groupPosition' || away?.kind !== 'groupPosition') continue
      pairs.push(`${home.group}${String(home.position)}v${away.group}${String(away.position)}`)
    }

    expect(pairs).toContain('A1vB2')
    expect(pairs).toContain('B1vC2')
    expect(pairs).toContain('C1vD2')
    expect(pairs).toContain('D1vA2')
  })

  it('includes every qualifier exactly once', () => {
    const slots = seedQualifierSlots(4, 2)
    const keys = slots
      .filter((s) => s.kind === 'groupPosition')
      .map((s) => (s.kind === 'groupPosition' ? `${s.group}${String(s.position)}` : ''))

    expect(new Set(keys).size).toBe(8)
  })

  it('pads with byes when qualifiers are not a power of two', () => {
    // 3 groups × 2 = 6 qualifiers → 8-slot bracket → 2 byes.
    const slots = seedQualifierSlots(3, 2)

    expect(slots).toHaveLength(8)
    expect(slots.filter((s) => s.kind === 'bye')).toHaveLength(2)
  })

  it('handles one qualifier per group', () => {
    const slots = seedQualifierSlots(4, 1)
    const groups = slots
      .filter((s) => s.kind === 'groupPosition')
      .map((s) => (s.kind === 'groupPosition' ? s.group : ''))

    expect(new Set(groups).size).toBe(4)
  })
})

describe('generateGroupsToKnockout', () => {
  describe('with 16 participants in 4 groups', () => {
    const participants = ids(16)
    const fixture = generateGroupsToKnockout(participants, { groups: 4 })

    it('creates the groups', () => {
      expect(fixture.groups).toHaveLength(4)
      expect(fixture.groups.map((g) => g.label)).toEqual(['A', 'B', 'C', 'D'])
    })

    it('plays a full round robin inside each group', () => {
      for (const group of fixture.groups) {
        const groupMatches = fixture.matches.filter((m) => m.group === group.label)
        // 4 participants → 6 matches.
        expect(groupMatches, `group ${group.label}`).toHaveLength(6)
      }
    })

    it('adds a knockout bracket for the 8 qualifiers', () => {
      const knockout = fixture.matches.filter((m) => m.side === 'main')
      // 8 qualifiers → 7 matches.
      expect(knockout).toHaveLength(7)
    })

    it('references qualifiers as group positions, not participants', () => {
      const firstKnockoutRound = fixture.matches.filter((m) => m.side === 'main' && m.round === 1)

      for (const match of firstKnockoutRound) {
        expect(match.home.kind).toBe('groupPosition')
        expect(match.away.kind).toBe('groupPosition')
      }
    })

    it('emits unique match ids across groups and knockout', () => {
      expect(new Set(fixture.matches.map((m) => m.id)).size).toBe(fixture.matches.length)
    })
  })

  it('supports one qualifier per group', () => {
    const fixture = generateGroupsToKnockout(ids(16), { groups: 4, qualifiersPerGroup: 1 })
    const knockout = fixture.matches.filter((m) => m.side === 'main')

    // 4 qualifiers → 3 matches.
    expect(knockout).toHaveLength(3)
  })

  it('supports double legs inside groups', () => {
    const fixture = generateGroupsToKnockout(ids(8), { groups: 2, legs: 2 })
    const groupMatches = fixture.matches.filter((m) => m.side === 'group')

    // 2 groups of 4, each 6 matches per leg × 2 legs.
    expect(groupMatches).toHaveLength(24)
  })

  it('supports a third-place playoff', () => {
    const fixture = generateGroupsToKnockout(ids(16), { groups: 4, thirdPlace: true })
    expect(fixture.matches.some((m) => m.side === 'thirdPlace')).toBe(true)
  })

  describe('validation', () => {
    it('rejects more groups than participants', () => {
      expect(() => generateGroupsToKnockout(ids(4), { groups: 8 })).toThrow(EngineError)
    })

    it('rejects groups too small to supply their qualifiers', () => {
      // 8 participants in 4 groups = 2 each, but asking 3 to qualify.
      expect(() =>
        generateGroupsToKnockout(ids(8), { groups: 4, qualifiersPerGroup: 3 }),
      ).toThrow(/must qualify/)
    })

    it('rejects a field below four', () => {
      expect(() => generateGroupsToKnockout(ids(3), { groups: 1 })).toThrow(EngineError)
    })

    it('rejects duplicates', () => {
      expect(() => generateGroupsToKnockout(['a', 'b', 'c', 'a'], { groups: 2 })).toThrow(
        EngineError,
      )
    })
  })

  it('is deterministic', () => {
    expect(generateGroupsToKnockout(ids(16), { groups: 4 })).toEqual(
      generateGroupsToKnockout(ids(16), { groups: 4 }),
    )
  })
})

describe('resolveGroupQualifiers', () => {
  const participants = ids(8)
  const fixture = generateGroupsToKnockout(participants, { groups: 2 })

  /** Plays every group match with the better seed winning. */
  function playGroups(): MatchResult[] {
    return fixture.matches
      .filter((m) => m.side === 'group')
      .map((m) => {
        const home = m.home.kind === 'participant' ? m.home.participantId : ''
        const away = m.away.kind === 'participant' ? m.away.participantId : ''
        const homeWins = participants.indexOf(home) <= participants.indexOf(away)
        return {
          matchId: m.id,
          homeParticipantId: home,
          awayParticipantId: away,
          sets: homeWins ? [{ home: 6, away: 2 }] : [{ home: 2, away: 6 }],
        }
      })
  }

  it('maps each group position to a participant', () => {
    const qualifiers = resolveGroupQualifiers(fixture.groups, playGroups())

    // Group A holds seeds 1, 4, 5, 8 → winner is p1, runner-up p4.
    expect(qualifiers.get('A:1')).toBe('p1')
    expect(qualifiers.get('A:2')).toBe('p4')
    expect(qualifiers.get('B:1')).toBe('p2')
    expect(qualifiers.get('B:2')).toBe('p3')
  })

  it('resolves a groupPosition slot to a name', () => {
    const qualifiers = resolveGroupQualifiers(fixture.groups, playGroups())
    const knockoutFirst = fixture.matches.find((m) => m.side === 'main' && m.round === 1)

    expect(resolveGroupSlot(knockoutFirst!.home, qualifiers)).toBeTruthy()
  })

  it('returns nothing for a slot that is not a group position', () => {
    expect(resolveGroupSlot({ kind: 'bye' }, new Map())).toBeNull()
  })

  it('only counts matches within the group', () => {
    // A result between two participants in different groups must not leak into
    // either group's table.
    const cross: MatchResult = {
      matchId: 'cross',
      homeParticipantId: 'p1',
      awayParticipantId: 'p2',
      sets: [{ home: 6, away: 0 }],
    }

    const withCross = resolveGroupQualifiers(fixture.groups, [...playGroups(), cross])
    const without = resolveGroupQualifiers(fixture.groups, playGroups())

    expect(withCross).toEqual(without)
  })

  it('handles an unplayed group stage without throwing', () => {
    const qualifiers = resolveGroupQualifiers(fixture.groups, [])
    // Positions still resolve (everyone level), just not meaningfully.
    expect(qualifiers.size).toBe(8)
  })
})
