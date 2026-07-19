/**
 * Seeded pseudo-random number generator for the scheduling engine.
 *
 * Math.random() is banned in src/engine (enforced by eslint.config.js) and this
 * is the reason why: draws must be REPRODUCIBLE. The seed is persisted on the
 * tournament (tournaments.draw_seed), so when an organiser is challenged about a
 * bracket in front of forty people, regenerating from the same seed produces the
 * identical draw. With Math.random() the draw is unauditable and unrepeatable —
 * a regenerate after an accidental click would silently reshuffle every match.
 *
 * mulberry32: 32-bit state, fast, good distribution for our purposes. We are
 * shuffling at most a few hundred participants, not doing cryptography.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number
}

export function createRng(seed: number): Rng {
  // Normalise to a 32-bit unsigned integer so a float or negative seed still
  // produces a stable, well-distributed stream.
  let state = seed >>> 0

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    nextInt(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`nextInt requires a positive integer bound, got ${maxExclusive}`)
      }
      return Math.floor(next() * maxExclusive)
    },
  }
}

/**
 * Fisher-Yates shuffle. Returns a new array; the input is not mutated, because
 * engine functions are pure and callers reuse their inputs.
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1)
    const a = result[i]
    const b = result[j]
    // The index guard satisfies noUncheckedIndexedAccess without a non-null
    // assertion; both indices are provably in range.
    if (a !== undefined && b !== undefined) {
      result[i] = b
      result[j] = a
    }
  }
  return result
}
