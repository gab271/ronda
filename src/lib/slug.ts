/**
 * Public tournament slugs.
 *
 * The slug is the whole product surface: one link, shared into a WhatsApp group,
 * read aloud at a club, typed by hand into a phone. Two properties follow, and
 * they pull in opposite directions from a name-derived slug:
 *
 * 1. UNGUESSABLE. `tournaments.public_slug` is NOT NULL, so a draft has a slug
 *    from the moment it is created — before the organiser has decided anything
 *    is ready to show. get_public_tournament() refuses to serve drafts, but the
 *    slug must not be enumerable either way. That rules out Math.random(), which
 *    is seeded predictably in every engine, and rules out the engine's own
 *    createRng(): that one is deliberately reproducible from draw_seed, which is
 *    exactly wrong here. Randomness comes from the platform CSPRNG.
 *
 * 2. READABLE ALOUD. The alphabet drops the four characters people confuse when
 *    reading or transcribing: 0/O and 1/l. Lowercase only — "capital A, lowercase
 *    b" is not a thing anyone should have to say across a padel court.
 *
 * Dropping exactly four of 36 alphanumerics leaves 32, which is what makes the
 * uniformity below free: 256 is divisible by 32, so a byte can be reduced with
 * `% 32` and stay perfectly uniform. At 36 characters that same modulo would
 * quietly favour the first 4 — a bias that never shows up in testing and weakens
 * the guarantee in (1).
 */

/** 32 characters: digits 2-9 and a-z, minus the confusable `0`, `1`, `l`, `o`. */
export const SLUG_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz'

/** 10 characters over a 32-symbol alphabet = 2^50 possibilities. */
export const SLUG_LENGTH = 10

/**
 * Thrown rather than falling back to Math.random(). A silent downgrade here
 * would turn unguessable slugs into predictable ones with nothing to notice.
 */
export class InsecureRandomError extends Error {
  constructor() {
    super('crypto.getRandomValues is unavailable; refusing to generate a guessable slug')
    this.name = 'InsecureRandomError'
  }
}

/**
 * Generates a public slug. Available in the browser and in a Cloudflare Worker
 * (milestone 4's edge renderer) — `crypto` is a global in both.
 */
export function generatePublicSlug(length: number = SLUG_LENGTH): string {
  const webcrypto = globalThis.crypto
  if (!webcrypto?.getRandomValues) throw new InsecureRandomError()

  const bytes = new Uint8Array(length)
  webcrypto.getRandomValues(bytes)

  let slug = ''
  for (const byte of bytes) {
    // Uniform because SLUG_ALPHABET.length is 32 and 256 % 32 === 0.
    slug += SLUG_ALPHABET[byte % SLUG_ALPHABET.length]
  }
  return slug
}

/** True when `value` could have been produced by generatePublicSlug(). */
export function isValidPublicSlug(value: string, length: number = SLUG_LENGTH): boolean {
  if (value.length !== length) return false
  for (const char of value) {
    if (!SLUG_ALPHABET.includes(char)) return false
  }
  return true
}
