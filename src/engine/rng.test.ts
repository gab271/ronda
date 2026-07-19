import { describe, expect, it } from 'vitest'
import { createRng, shuffle } from './rng'

/**
 * These tests exist in milestone 1 mainly to prove the engine test project is
 * wired correctly (node environment, no DOM) before milestone 2 puts real
 * algorithms behind it. The determinism assertions are load-bearing regardless:
 * reproducible draws are a product requirement, not an implementation detail.
 */

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)

    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())

    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const a = createRng(1)
    const b = createRng(2)

    expect(a.next()).not.toBe(b.next())
  })

  it('stays within [0, 1)', () => {
    const rng = createRng(999)
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('nextInt stays within bounds', () => {
    const rng = createRng(42)
    for (let i = 0; i < 500; i += 1) {
      const value = rng.nextInt(7)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(7)
    }
  })

  it('rejects a non-positive bound rather than returning nonsense', () => {
    const rng = createRng(1)
    expect(() => rng.nextInt(0)).toThrow(RangeError)
    expect(() => rng.nextInt(-3)).toThrow(RangeError)
  })
})

describe('shuffle', () => {
  it('is deterministic for a given seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

    expect(shuffle(items, createRng(7))).toEqual(shuffle(items, createRng(7)))
  })

  it('does not mutate its input', () => {
    const items = ['a', 'b', 'c']
    const copy = [...items]

    shuffle(items, createRng(3))

    expect(items).toEqual(copy)
  })

  it('preserves every element exactly once', () => {
    const items = Array.from({ length: 32 }, (_, i) => i)
    const shuffled = shuffle(items, createRng(2026))

    expect([...shuffled].sort((a, b) => a - b)).toEqual(items)
  })
})

/**
 * ENGINE PURITY.
 *
 * The real gate is tsconfig.engine.json, which omits the DOM lib so engine code
 * referencing `window` or `fetch` cannot type-check. This test is the runtime
 * half: engine tests run with environment 'node', so if the engine ever grows a
 * browser dependency it fails here too, and the failure names the problem.
 */
describe('engine environment', () => {
  it('runs with no DOM available', () => {
    expect(typeof globalThis.document).toBe('undefined')
    expect(typeof globalThis.window).toBe('undefined')
  })
})
