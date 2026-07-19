/**
 * The draw that plays itself in the hero.
 *
 * Real bracket, real seeding, real scores. The seeding follows the engine's own
 * order for eight entrants — 1v8, 4v5, 2v7, 3v6 — so what a visitor sees is
 * genuinely what `generateSingleElimination` produces, not a drawing of one.
 *
 * There is a deliberate upset: seed 3 knocks out seed 2 in the semi-final. A
 * bracket where every favourite wins looks like test data, and the whole point
 * of the hero is that this is a real Saturday at a club.
 *
 * Names carry Spanish diacritics (Ibáñez, Marín) because the type has to prove
 * it handles them — this is the first thing a Spanish organiser will notice if
 * it is wrong.
 *
 * Timings are in milliseconds from page load. Kept in data rather than CSS so
 * the sequence can be read and adjusted in one place.
 */

export interface DemoSide {
  /** Bracket seed, shown as a small tabular figure. */
  readonly seed: number
  readonly name: string
  readonly sets: readonly [number, number]
  readonly won: boolean
}

export interface DemoMatch {
  readonly id: string
  /** 1 = quarter-final, 2 = semi-final, 3 = final. */
  readonly round: 1 | 2 | 3
  readonly home: DemoSide
  readonly away: DemoSide
  /** When this match's result appears. */
  readonly revealAt: number
  /** When the winner's name lands in the next round. */
  readonly advanceAt: number
  /** The final holds on "EN JUEGO" before resolving — the one use of yellow. */
  readonly liveFrom?: number
}

const side = (
  seed: number,
  name: string,
  sets: readonly [number, number],
  won: boolean,
): DemoSide => ({ seed, name, sets, won })

/**
 * TIMING.
 *
 * The whole sequence finishes inside ~3.4s. An earlier cut ran to 5.9s and a
 * screenshot taken at 6.5s still caught it mid-flight, which is the proof that
 * it was too slow: a visitor scrolls before the champion appears, so the payoff
 * never lands. Quarter-finals now resolve almost together and the pace only
 * slows for the final, where the tension actually is.
 */
export const DEMO_MATCHES: readonly DemoMatch[] = [
  // ── Quarter-finals ────────────────────────────────────────────────────────
  {
    id: 'qf1',
    round: 1,
    home: side(1, 'García / Ruiz', [6, 3], true),
    away: side(8, 'Ibáñez / Roca', [4, 6], false),
    revealAt: 620,
    advanceAt: 900,
  },
  {
    id: 'qf2',
    round: 1,
    home: side(4, 'Bello / Sanz', [6, 7], true),
    away: side(5, 'Navarro / Gil', [2, 5], false),
    revealAt: 740,
    advanceAt: 1020,
  },
  {
    id: 'qf3',
    round: 1,
    home: side(2, 'Ferrer / Marín', [6, 6], true),
    away: side(7, 'Molina / Vera', [3, 4], false),
    revealAt: 860,
    advanceAt: 1140,
  },
  {
    id: 'qf4',
    round: 1,
    home: side(3, 'Ortega / Lama', [7, 6], true),
    away: side(6, 'Cruz / Pardo', [6, 4], false),
    revealAt: 980,
    advanceAt: 1260,
  },

  // ── Semi-finals ───────────────────────────────────────────────────────────
  {
    id: 'sf1',
    round: 2,
    home: side(1, 'García / Ruiz', [6, 6], true),
    away: side(4, 'Bello / Sanz', [4, 4], false),
    revealAt: 1700,
    advanceAt: 1980,
  },
  {
    // The upset: seed 3 puts out seed 2.
    id: 'sf2',
    round: 2,
    home: side(3, 'Ortega / Lama', [6, 7], true),
    away: side(2, 'Ferrer / Marín', [4, 5], false),
    revealAt: 1840,
    advanceAt: 2120,
  },

  // ── Final ─────────────────────────────────────────────────────────────────
  {
    id: 'f1',
    round: 3,
    home: side(1, 'García / Ruiz', [7, 6], true),
    away: side(3, 'Ortega / Lama', [5, 4], false),
    liveFrom: 2350,
    revealAt: 3000,
    advanceAt: 3200,
  },
]

/** Rounds, outermost first. Used to lay out the columns. */
export const DEMO_ROUNDS = [1, 2, 3] as const

export const CHAMPION_AT = 3400

/**
 * Placeholder shown in a slot before its feeder has been decided.
 * Returned as an i18n key + values so the component can translate it.
 */
export function feederLabel(round: 1 | 2 | 3, index: number): { round: number; index: number } {
  return { round, index }
}
