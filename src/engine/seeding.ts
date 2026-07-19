import { EngineError } from './types'

/** Smallest power of two >= n. A bracket must be a power of two to be balanced. */
export function bracketSize(participantCount: number): number {
  if (participantCount < 1) return 0
  let size = 1
  while (size < participantCount) size *= 2
  return size
}

/**
 * Standard bracket seeding order.
 *
 * Returns the seed numbers in bracket-position order, so `order[i]` is the seed
 * that belongs in slot i. Slots are paired (0,1), (2,3), … to form round one.
 *
 * The property this guarantees: the two strongest participants can only meet in
 * the final, the top four only in the semi-finals, and so on. Seeding is what
 * stops a draw putting the two best pairs in the club against each other in
 * round one, which is the single most visible way a bracket can look unfair.
 *
 * Built by repeated folding. Start with [1, 2]. To double the bracket, replace
 * each seed s with the pair (s, sum - s) where sum is one more than the new
 * size. Every seed is thus paired with its complement:
 *
 *   size 2 : [1, 2]
 *   size 4 : [1, 4, 2, 3]              → 1v4, 2v3
 *   size 8 : [1, 8, 4, 5, 2, 7, 3, 6]  → 1v8, 4v5, 2v7, 3v6
 *
 * At size 8, seed 1 meets seed 2 only in the final, and can meet 3 or 4 only in
 * the semi — which is exactly the guarantee above.
 */
export function seedOrder(size: number): number[] {
  if (size < 1) return []
  if ((size & (size - 1)) !== 0) {
    throw new EngineError('bracket_not_power_of_two', `Bracket size must be a power of two, got ${String(size)}.`)
  }
  if (size === 1) return [1]

  let order = [1, 2]
  while (order.length < size) {
    const sum = order.length * 2 + 1
    const next: number[] = []
    for (const seed of order) {
      next.push(seed, sum - seed)
    }
    order = next
  }
  return order
}

/**
 * Orders participants by seed for placement into a bracket.
 *
 * Participants with an explicit seed keep it. Unseeded participants fill the
 * remaining places in their given order — which for a real tournament means the
 * organiser's list order, and after `shuffle()` means a random but reproducible
 * draw.
 */
export function orderBySeed<T extends { readonly id: string; readonly seed?: number | undefined }>(
  participants: readonly T[],
): T[] {
  const seeded = participants
    .filter((p) => typeof p.seed === 'number')
    .sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
  const unseeded = participants.filter((p) => typeof p.seed !== 'number')

  const result: T[] = []
  const used = new Set<string>()

  // Honour explicit seed numbers as positions where possible: a participant
  // seeded 3 should land in seed slot 3, not merely third among the seeded.
  const bySeedNumber = new Map<number, T>()
  for (const p of seeded) {
    const seed = p.seed ?? 0
    if (!bySeedNumber.has(seed)) bySeedNumber.set(seed, p)
  }

  const queue = [...unseeded, ...seeded.filter((p) => bySeedNumber.get(p.seed ?? 0) !== p)]
  let queueIndex = 0

  for (let position = 1; position <= participants.length; position += 1) {
    const explicit = bySeedNumber.get(position)
    if (explicit && !used.has(explicit.id)) {
      result.push(explicit)
      used.add(explicit.id)
      continue
    }
    while (queueIndex < queue.length) {
      const candidate = queue[queueIndex]
      queueIndex += 1
      if (candidate && !used.has(candidate.id)) {
        result.push(candidate)
        used.add(candidate.id)
        break
      }
    }
  }

  return result
}

/**
 * Names a knockout round from how many matches it contains.
 *
 * Returns an i18n key rather than a string — the engine has no user-facing copy
 * by design, and "cuartos de final" is not a translation of "quarter-final" that
 * a generic string table would get right.
 */
export function knockoutRoundLabel(matchesInRound: number): string {
  switch (matchesInRound) {
    case 1:
      return 'round.final'
    case 2:
      return 'round.semiFinal'
    case 4:
      return 'round.quarterFinal'
    default:
      return `round.roundOf${String(matchesInRound * 2)}`
  }
}
