import { describe, expect, it } from 'vitest'

import {
  doubleEliminationMatchCount,
  roundRobinMatchCount,
  singleEliminationMatchCount,
} from '~/engine'

import {
  generateFixtureForFormat,
  orderParticipantsForDraw,
  type DrawParticipant,
} from './generateFixture'

function unseeded(count: number): DrawParticipant[] {
  return Array.from({ length: count }, (_, i) => ({ id: `p${String(i + 1)}`, seed: null }))
}

describe('orderParticipantsForDraw', () => {
  it('is reproducible from the same draw seed', () => {
    // The guarantee the whole feature rests on: draw_seed is persisted, so a
    // disputed bracket can be regenerated and shown to be identical.
    const participants = unseeded(16)
    expect(orderParticipantsForDraw(participants, 12345)).toEqual(
      orderParticipantsForDraw(participants, 12345),
    )
  })

  it('produces a different order for a different seed', () => {
    const participants = unseeded(16)
    expect(orderParticipantsForDraw(participants, 1)).not.toEqual(
      orderParticipantsForDraw(participants, 2),
    )
  })

  it('does not simply preserve the pasted order', () => {
    // Otherwise an organiser could rig the bracket by sorting a spreadsheet.
    const participants = unseeded(16)
    const order = orderParticipantsForDraw(participants, 99)
    expect(order).not.toEqual(participants.map((p) => p.id))
  })

  it('keeps every participant exactly once', () => {
    const participants = unseeded(16)
    const order = orderParticipantsForDraw(participants, 7)
    expect(order).toHaveLength(16)
    expect(new Set(order).size).toBe(16)
  })

  it('places seeds ahead of the unseeded field', () => {
    const participants: DrawParticipant[] = [
      { id: 'c', seed: null },
      { id: 'a', seed: 1 },
      { id: 'd', seed: null },
      { id: 'b', seed: 2 },
    ]
    const order = orderParticipantsForDraw(participants, 42)

    expect(order[0]).toBe('a')
    expect(order[1]).toBe('b')
    expect(order.slice(2).sort()).toEqual(['c', 'd'])
  })

  it('orders seeds by their number, not their position in the list', () => {
    const participants: DrawParticipant[] = [
      { id: 'third', seed: 3 },
      { id: 'first', seed: 1 },
      { id: 'second', seed: 2 },
    ]
    expect(orderParticipantsForDraw(participants, 1)).toEqual(['first', 'second', 'third'])
  })

  it('handles an all-seeded field', () => {
    const participants: DrawParticipant[] = [
      { id: 'b', seed: 2 },
      { id: 'a', seed: 1 },
    ]
    expect(orderParticipantsForDraw(participants, 5)).toEqual(['a', 'b'])
  })

  it('handles an empty field', () => {
    expect(orderParticipantsForDraw([], 1)).toEqual([])
  })
})

describe('generateFixtureForFormat', () => {
  const eight = unseeded(8)

  it.each([
    ['round_robin', roundRobinMatchCount(8, 1)],
    ['single_elim', singleEliminationMatchCount(8, false)],
    ['double_elim', doubleEliminationMatchCount(8)],
  ] as const)('generates exactly the %s match count the engine declares', (format, expected) => {
    // Asserting against the engine's own counters rather than a number I worked
    // out by hand — which is how this test first claimed 8-player double
    // elimination was 14 matches, forgetting the grand-final reset is emitted
    // unconditionally so the bracket keeps a fixed shape.
    const fixture = generateFixtureForFormat({ format, participants: eight, drawSeed: 1 })
    expect(fixture.matches).toHaveLength(expected)
  })

  it('produces an identical fixture for the same seed', () => {
    const a = generateFixtureForFormat({
      format: 'single_elim',
      participants: eight,
      drawSeed: 777,
    })
    const b = generateFixtureForFormat({
      format: 'single_elim',
      participants: eight,
      drawSeed: 777,
    })
    expect(a).toEqual(b)
  })

  it('produces a different fixture for a different seed', () => {
    const a = generateFixtureForFormat({ format: 'single_elim', participants: eight, drawSeed: 1 })
    const b = generateFixtureForFormat({ format: 'single_elim', participants: eight, drawSeed: 2 })
    expect(a).not.toEqual(b)
  })

  it('honours legs for a round robin', () => {
    const single = generateFixtureForFormat({
      format: 'round_robin',
      participants: unseeded(4),
      drawSeed: 1,
      config: { legs: 1 },
    })
    const double = generateFixtureForFormat({
      format: 'round_robin',
      participants: unseeded(4),
      drawSeed: 1,
      config: { legs: 2 },
    })
    expect(double.matches).toHaveLength(single.matches.length * 2)
  })

  it('adds a third-place match when asked', () => {
    const without = generateFixtureForFormat({
      format: 'single_elim',
      participants: eight,
      drawSeed: 1,
      config: { thirdPlace: false },
    })
    const with3rd = generateFixtureForFormat({
      format: 'single_elim',
      participants: eight,
      drawSeed: 1,
      config: { thirdPlace: true },
    })
    expect(with3rd.matches).toHaveLength(without.matches.length + 1)
  })

  it('splits a group stage into the configured number of groups', () => {
    const fixture = generateFixtureForFormat({
      format: 'groups_knockout',
      participants: eight,
      drawSeed: 1,
      config: { groups: 2, qualifiersPerGroup: 2 },
    })
    const groups = new Set(
      fixture.matches.filter((m) => m.side === 'group').map((m) => m.group),
    )
    expect(groups.size).toBe(2)
  })

  it('generates only the first round of a Swiss tournament', () => {
    // Swiss pairs each round from the previous round's results. Generating
    // further rounds up front would mean inventing results.
    const fixture = generateFixtureForFormat({
      format: 'swiss',
      participants: eight,
      drawSeed: 1,
    })
    expect(fixture.rounds).toHaveLength(1)
    expect(fixture.matches).toHaveLength(4)
    expect(fixture.matches.every((m) => m.round === 1)).toBe(true)
  })

  it('records the Swiss bye for an odd field', () => {
    const fixture = generateFixtureForFormat({
      format: 'swiss',
      participants: unseeded(7),
      drawSeed: 1,
    })
    expect(fixture.byes).toHaveLength(1)
    expect(fixture.byes[0]?.round).toBe(1)
  })
})
