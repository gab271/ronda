import { describe, expect, it } from 'vitest'

import {
  generateDoubleElimination,
  generateGroupsToKnockout,
  generateRoundRobin,
  generateSingleElimination,
  type Fixture,
} from '~/engine'

import { buildFixtureRows, type FixtureRows } from './fixtureRows'

/**
 * Driven by real engine output rather than hand-built fixtures. A hand-built
 * fixture tests the mapping against my understanding of the engine; the real
 * generators test it against the engine.
 */

/**
 * Narrows a jsonb column to a plain object.
 *
 * `Json` includes arrays and primitives, so indexing one directly is a type
 * error. Every assertion below goes through this rather than casting.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Deterministic ids so assertions can name them. */
function counter(): () => string {
  let n = 0
  return () => {
    n += 1
    return `id-${String(n).padStart(3, '0')}`
  }
}

function build(fixture: Fixture, format: Parameters<typeof buildFixtureRows>[0]['format']) {
  return buildFixtureRows({
    tournamentId: 't-1',
    format,
    fixture,
    newId: counter(),
  })
}

/** Every match_id referenced by a slot must be a match we are inserting. */
function assertReferencesResolve(rows: FixtureRows) {
  const ids = new Set(rows.matches.map((m) => m.id))
  for (const match of rows.matches) {
    for (const source of [match.home_source, match.away_source]) {
      if (source === null || typeof source !== 'object' || Array.isArray(source)) continue
      const ref = source['match_id']
      if (typeof ref === 'string') {
        expect(ids).toContain(ref)
      }
    }
  }
}

describe('buildFixtureRows — round robin', () => {
  const fixture = generateRoundRobin(['p1', 'p2', 'p3', 'p4'])
  const rows = build(fixture, 'round_robin')

  it('produces one group stage', () => {
    // A round robin is a single group in which everyone plays everyone. The
    // schema's stage_kind describes shapes, not formats, so 'group' is correct
    // and there is no 'round_robin' kind to reach for.
    expect(rows.stages).toHaveLength(1)
    expect(rows.stages[0]?.kind).toBe('group')
  })

  it('names the implicit single group rather than leaving it blank', () => {
    // A plain round robin emits side 'group' with no group label — it is one
    // implicit group containing everybody. `stages.name` is NOT NULL, so an
    // empty string would be accepted by the database and mean nothing to a
    // reader.
    expect(rows.stages[0]?.name).toBe('main')
    expect(rows.stages[0]?.name).not.toBe('')
  })

  it('produces one round row per engine round', () => {
    const engineRounds = new Set(fixture.matches.map((m) => m.round))
    expect(rows.rounds).toHaveLength(engineRounds.size)
  })

  it('maps every match to both participants with no slot source', () => {
    expect(rows.matches).toHaveLength(fixture.matches.length)
    for (const match of rows.matches) {
      expect(match.home_participant_id).not.toBeNull()
      expect(match.away_participant_id).not.toBeNull()
      expect(match.home_source).toBeNull()
      expect(match.away_source).toBeNull()
      expect(match.status).toBe('pending')
    }
  })

  it('attaches every match to its tournament, stage and round', () => {
    for (const match of rows.matches) {
      expect(match.tournament_id).toBe('t-1')
      expect(match.stage_id).toBe(rows.stages[0]?.id)
      expect(rows.rounds.map((r) => r.id)).toContain(match.round_id)
    }
  })
})

describe('buildFixtureRows — single elimination', () => {
  const fixture = generateSingleElimination(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'])
  const rows = build(fixture, 'single_elim')

  it('produces a knockout stage', () => {
    expect(rows.stages).toHaveLength(1)
    expect(rows.stages[0]?.kind).toBe('knockout')
  })

  it('rewrites winner-of references to real row ids', () => {
    const withSource = rows.matches.filter((m) => m.home_source !== null)
    expect(withSource.length).toBeGreaterThan(0)
    assertReferencesResolve(rows)
  })

  it('never writes an engine id into a source', () => {
    // The engine's ids are structural ("m-r2-1"). Leaking one into a row would
    // produce a reference that looks plausible and resolves to nothing.
    const engineIds = new Set(fixture.matches.map((m) => m.id))
    for (const match of rows.matches) {
      for (const source of [match.home_source, match.away_source]) {
        if (source === null || typeof source !== 'object' || Array.isArray(source)) continue
        const ref = source['match_id']
        if (typeof ref === 'string') expect(engineIds).not.toContain(ref)
      }
    }
  })
})

describe('buildFixtureRows — byes', () => {
  // Five participants in an eight-bracket: three byes, given to the top seeds.
  const fixture = generateSingleElimination(['p1', 'p2', 'p3', 'p4', 'p5'])
  const rows = build(fixture, 'single_elim')

  it('marks a bye match finished rather than pending', () => {
    const byes = rows.matches.filter((m) => m.status === 'bye')
    expect(byes.length).toBeGreaterThan(0)

    // Left 'pending', these would sit in every "still to play" count for the
    // whole tournament even though nobody will ever play them.
    for (const bye of byes) {
      const sources = [bye.home_source, bye.away_source]
      expect(sources.some((s) => s !== null && typeof s === 'object' && !Array.isArray(s) && s['kind'] === 'bye')).toBe(true)
    }
  })

  it('records a bye explicitly rather than as a null participant', () => {
    // "Nobody is here yet" and "nobody is ever coming" must stay distinguishable.
    for (const match of rows.matches) {
      if (match.home_participant_id === null && match.home_source === null) {
        throw new Error('a side with no participant and no source is ambiguous')
      }
    }
  })
})

describe('buildFixtureRows — double elimination', () => {
  const fixture = generateDoubleElimination(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'])
  const rows = build(fixture, 'double_elim')

  it('splits winners, losers and grand final into separate stages', () => {
    const names = rows.stages.map((s) => s.name)
    expect(names).toContain('winners')
    expect(names).toContain('losers')
    expect(rows.stages.length).toBeGreaterThanOrEqual(3)
  })

  it('persists the grand-final decider as conditional', () => {
    // The engine emits the decider unconditionally so the bracket keeps a fixed
    // shape, and marks it played-only-if. Losing that flag on the way to the
    // database would show organisers a match that must be played even when the
    // winners-bracket finalist has already won without ever losing twice.
    const conditional = rows.matches.filter((m) => m.condition !== null)
    expect(conditional).toHaveLength(1)

    const condition = asRecord(conditional[0]?.condition)
    expect(condition?.['kind']).toBe('if_away_won')
    // The reference is rewritten to a row id, like every other cross-reference.
    expect(rows.matches.map((m) => m.id)).toContain(condition?.['match_id'])
  })

  it('leaves ordinary matches unconditional', () => {
    const unconditional = rows.matches.filter((m) => m.condition === null)
    expect(unconditional.length).toBe(rows.matches.length - 1)
  })

  it('resolves both winner-of and loser-of references', () => {
    const kinds = new Set<unknown>()
    for (const match of rows.matches) {
      for (const source of [match.home_source, match.away_source]) {
        if (source !== null && typeof source === 'object' && !Array.isArray(source)) {
          kinds.add(source['kind'])
        }
      }
    }
    expect(kinds).toContain('winner_of')
    expect(kinds).toContain('loser_of')
    assertReferencesResolve(rows)
  })
})

describe('buildFixtureRows — groups to knockout', () => {
  const fixture = generateGroupsToKnockout(
    ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
    { groups: 2, qualifiersPerGroup: 2 },
  )
  const rows = build(fixture, 'groups_knockout')

  it('gives each group its own stage', () => {
    // `matches` has no group column, so the stage is the only thing that can
    // carry which group a match belongs to. One shared "group stage" row would
    // lose that.
    const groupStages = rows.stages.filter((s) => s.kind === 'group')
    expect(groupStages).toHaveLength(2)
    expect(groupStages.map((s) => s.name).sort()).toEqual(['A', 'B'])
  })

  it('adds a knockout stage alongside the groups', () => {
    expect(rows.stages.some((s) => s.kind === 'knockout')).toBe(true)
  })

  it('stores qualifier slots structurally', () => {
    const groupPositions = rows.matches
      .flatMap((m) => [asRecord(m.home_source), asRecord(m.away_source)])
      .filter((s) => s !== null && s['kind'] === 'group_position')

    expect(groupPositions.length).toBeGreaterThan(0)
    for (const source of groupPositions) {
      expect(typeof source?.['group']).toBe('string')
      expect(typeof source?.['position']).toBe('number')
    }
  })
})

describe('buildFixtureRows — no prose reaches the database', () => {
  const fixtures: readonly [Fixture, Parameters<typeof buildFixtureRows>[0]['format']][] = [
    [generateRoundRobin(['p1', 'p2', 'p3', 'p4']), 'round_robin'],
    [generateSingleElimination(['p1', 'p2', 'p3', 'p4', 'p5']), 'single_elim'],
    [generateDoubleElimination(['p1', 'p2', 'p3', 'p4']), 'double_elim'],
  ]

  it('never writes a label into a slot source', () => {
    // 0001_init.sql shows a "label" key in its example and
    // get_public_tournament exposes it as homeLabel. Writing "Ganador C1" here
    // would make the draw sheet permanently monolingual — in whichever language
    // the ORGANISER happened to be using, not the reader's.
    for (const [fixture, format] of fixtures) {
      for (const match of build(fixture, format).matches) {
        for (const source of [match.home_source, match.away_source]) {
          if (source !== null && typeof source === 'object' && !Array.isArray(source)) {
            expect(source).not.toHaveProperty('label')
          }
        }
      }
    }
  })

  it('keeps stage names language-neutral', () => {
    // Group letters, or the engine's own side tokens. Never "Grupo A".
    const allowed = /^([A-Z]|winners|losers|grandFinal|main|thirdPlace|group)$/
    for (const [fixture, format] of fixtures) {
      for (const stage of build(fixture, format).stages) {
        expect(stage.name).toMatch(allowed)
      }
    }
  })

  it('leaves round names null, to be derived at render time', () => {
    for (const [fixture, format] of fixtures) {
      for (const round of build(fixture, format).rounds) {
        expect(round.name).toBeNull()
      }
    }
  })
})

describe('buildFixtureRows — determinism and failure', () => {
  it('is deterministic for the same fixture and id source', () => {
    const fixture = generateSingleElimination(['p1', 'p2', 'p3', 'p4'])
    expect(build(fixture, 'single_elim')).toEqual(build(fixture, 'single_elim'))
  })

  it('throws rather than writing a dangling reference', () => {
    const broken: Fixture = {
      matches: [
        {
          id: 'm1',
          side: 'main',
          round: 1,
          order: 1,
          home: { kind: 'winnerOf', matchId: 'does-not-exist' },
          away: { kind: 'bye' },
        },
      ],
      rounds: [],
      byes: [],
    }

    expect(() => build(broken, 'single_elim')).toThrow(/unknown match/)
  })
})
