/**
 * Parses a pasted participant list.
 *
 * Organisers do not type participants into a form one at a time — they arrive
 * with a WhatsApp message, a spreadsheet column, or a note on their phone, and
 * paste the lot. This turns that reality into rows.
 *
 * Pure and framework-free so every shape a real list arrives in can be tested
 * cheaply. The interesting cases are all human, not technical: inconsistent
 * separators, seed numbers written four different ways, the same pair entered
 * twice with an accent typed differently.
 *
 * ── Seeds are only read when explicitly punctuated ───────────────────────────
 * "1. Juan y María" is a seed. "4 Estaciones" is a club named after the seasons.
 * A number followed by whitespace alone is ambiguous, and guessing wrong is not
 * a cosmetic error: seeds decide who meets whom, so a phantom seed silently
 * rearranges the draw and the organiser has no reason to look for it. When in
 * doubt this keeps the number as part of the name, which is visible and
 * correctable, rather than inventing a seed, which is neither.
 */

import type { ParticipantKind } from '~/data/supabase/database.types'

export interface ParsedParticipant {
  readonly displayName: string
  readonly seed: number | null
  readonly memberNames: readonly string[]
  readonly kind: ParticipantKind
  /** 1-based line in the pasted text, so a problem can be pointed at. */
  readonly line: number
}

export interface DuplicateGroup {
  readonly displayName: string
  /** 1-based lines the duplicate appeared on, in order. */
  readonly lines: readonly number[]
}

export interface ParseParticipantsResult {
  /** Duplicates appear once here, at their first occurrence. */
  readonly participants: readonly ParsedParticipant[]
  readonly duplicates: readonly DuplicateGroup[]
  /** Seeds given more than once. The draw would be arbitrary between them. */
  readonly repeatedSeeds: readonly number[]
}

export interface ParseParticipantsOptions {
  /**
   * Overrides the kind inferred from member count. A padel tournament is pairs
   * whether or not the organiser wrote both names.
   */
  readonly kind?: ParticipantKind
}

/**
 * A leading seed: "1.", "1)", "1 -", "1 –". Punctuation is required — see the
 * module comment.
 */
const SEED_PATTERN = /^\s*(\d{1,3})\s*[.)\-–]\s*(.+)$/

/**
 * Separators between the people inside one entry.
 *
 * Spanish uses both "y" and "e" ("María e Isabel"), and organisers mix in
 * slashes, ampersands and commas freely. Word separators require surrounding
 * whitespace so a name containing "y" is not torn in half.
 */
const MEMBER_SEPARATOR = /\s+y\s+|\s+e\s+|\s*[/&+,]\s*/i

/**
 * Comparison key for duplicate detection.
 *
 * Case and accents are stripped because the same pair genuinely does get typed
 * as "María" once and "Maria" the next time, and importing both creates a
 * tournament with a phantom entrant — which is only noticed when someone does
 * not turn up for a match.
 */
/**
 * Unicode combining diacritical marks (U+0300–U+036F), which is what NFD
 * decomposition splits accents into. Built from a string rather than written as
 * a regex literal so the range is legible: the literal characters are invisible
 * in an editor and impossible to review.
 */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'gu')

/** Any Unicode letter — accented and non-Latin names must pass. */
const HAS_LETTER = /\p{L}/u

function comparisonKey(displayName: string): string {
  return displayName
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function inferKind(memberCount: number): ParticipantKind {
  if (memberCount <= 1) return 'player'
  if (memberCount === 2) return 'pair'
  return 'team'
}

export function parseParticipantList(
  text: string,
  options: ParseParticipantsOptions = {},
): ParseParticipantsResult {
  const participants: ParsedParticipant[] = []
  const seenAt = new Map<string, number[]>()
  const seedCounts = new Map<number, number>()

  const lines = text.split(/\r?\n/)

  for (const [index, raw] of lines.entries()) {
    const line = index + 1
    const trimmed = raw.trim()
    if (trimmed === '') continue

    const seedMatch = SEED_PATTERN.exec(trimmed)
    const seed = seedMatch ? Number(seedMatch[1]) : null
    const remainder = seedMatch ? (seedMatch[2] ?? '') : trimmed

    const displayName = remainder.replace(/\s+/g, ' ').trim()
    if (displayName === '') continue

    // A name must contain at least one letter. Pasted lists are full of
    // fragments that are not names — an orphaned "1.", a "-" used as a bullet,
    // a row of dashes separating sections. Without this, "1." on its own line
    // becomes a participant called "1." and takes a place in the draw.
    if (!HAS_LETTER.test(displayName)) continue

    const key = comparisonKey(displayName)
    const previous = seenAt.get(key)
    if (previous) {
      // Recorded, not imported. Dropping it silently would leave the organiser
      // with fewer participants than they pasted and no way to know why.
      previous.push(line)
      continue
    }
    seenAt.set(key, [line])

    if (seed !== null) {
      seedCounts.set(seed, (seedCounts.get(seed) ?? 0) + 1)
    }

    const memberNames = displayName
      .split(MEMBER_SEPARATOR)
      .map((name) => name.trim())
      .filter((name) => name !== '')

    participants.push({
      displayName,
      seed,
      memberNames,
      kind: options.kind ?? inferKind(memberNames.length),
      line,
    })
  }

  const duplicates: DuplicateGroup[] = []
  for (const [key, lineNumbers] of seenAt) {
    if (lineNumbers.length < 2) continue
    const first = participants.find((p) => comparisonKey(p.displayName) === key)
    duplicates.push({ displayName: first?.displayName ?? key, lines: lineNumbers })
  }

  const repeatedSeeds = [...seedCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([seed]) => seed)
    .sort((a, b) => a - b)

  return { participants, duplicates, repeatedSeeds }
}
