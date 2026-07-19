import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  InsecureRandomError,
  SLUG_ALPHABET,
  SLUG_LENGTH,
  generatePublicSlug,
  isValidPublicSlug,
} from './slug'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SLUG_ALPHABET', () => {
  it('is exactly 32 characters, which is what keeps the modulo unbiased', () => {
    // Load-bearing, not cosmetic: generatePublicSlug reduces a byte with `% 32`.
    // At any length that does not divide 256 the early characters become more
    // likely. Changing this constant without changing the reduction silently
    // weakens slug unguessability.
    expect(SLUG_ALPHABET).toHaveLength(32)
    expect(256 % SLUG_ALPHABET.length).toBe(0)
  })

  it('omits the characters people confuse when reading a link aloud', () => {
    for (const confusable of ['0', '1', 'l', 'o', 'O', 'I']) {
      expect(SLUG_ALPHABET).not.toContain(confusable)
    }
  })

  it('has no duplicate characters', () => {
    expect(new Set(SLUG_ALPHABET).size).toBe(SLUG_ALPHABET.length)
  })

  it('is lowercase only, so a slug never has to be spelled with case', () => {
    expect(SLUG_ALPHABET).toBe(SLUG_ALPHABET.toLowerCase())
  })
})

describe('generatePublicSlug', () => {
  it('returns SLUG_LENGTH characters from the alphabet', () => {
    const slug = generatePublicSlug()
    expect(slug).toHaveLength(SLUG_LENGTH)
    expect(isValidPublicSlug(slug)).toBe(true)
  })

  it('maps all 256 byte values uniformly across the alphabet', () => {
    // Deterministic proof of no modulo bias: feed every possible byte exactly
    // once and assert each character comes back the same number of times.
    // 256 bytes / 32 characters = 8 each.
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => {
        for (let i = 0; i < array.length; i += 1) array[i] = i % 256
        return array
      },
    })

    const slug = generatePublicSlug(256)
    const counts = new Map<string, number>()
    for (const char of slug) counts.set(char, (counts.get(char) ?? 0) + 1)

    expect(counts.size).toBe(SLUG_ALPHABET.length)
    for (const char of SLUG_ALPHABET) {
      expect(counts.get(char)).toBe(8)
    }
  })

  it('does not repeat across many draws', () => {
    const slugs = new Set(Array.from({ length: 2000 }, () => generatePublicSlug()))
    expect(slugs.size).toBe(2000)
  })

  it('honours an explicit length', () => {
    expect(generatePublicSlug(4)).toHaveLength(4)
  })

  it('throws rather than silently falling back when crypto is unavailable', () => {
    // The dangerous failure mode is a quiet downgrade to Math.random(), which
    // would make every draft slug predictable without anything looking broken.
    vi.stubGlobal('crypto', undefined)
    expect(() => generatePublicSlug()).toThrow(InsecureRandomError)
  })
})

describe('isValidPublicSlug', () => {
  it('accepts a generated slug', () => {
    expect(isValidPublicSlug(generatePublicSlug())).toBe(true)
  })

  it('rejects the wrong length', () => {
    expect(isValidPublicSlug('abc')).toBe(false)
    expect(isValidPublicSlug(`${generatePublicSlug()}x`)).toBe(false)
  })

  it('rejects characters outside the alphabet', () => {
    expect(isValidPublicSlug('abcdefghi0')).toBe(false)
    expect(isValidPublicSlug('ABCDEFGHIJ')).toBe(false)
    expect(isValidPublicSlug('abcdefgh-i')).toBe(false)
  })
})
