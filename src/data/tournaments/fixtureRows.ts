/**
 * Turns engine output into database rows.
 *
 * The engine deliberately knows nothing about the schema: it returns structural
 * ids like "w-r2-m1" and `Slot` unions. This module is the seam, and it is a
 * pure function so the mapping can be tested exhaustively without a database —
 * the part most likely to be wrong is cross-references between matches, and
 * those are far cheaper to get right here than to debug against Postgres.
 *
 * ── The database stores structure, not prose ─────────────────────────────────
 * Nothing written here is language-specific. A bracket slot is persisted as
 * {"kind": "winner_of", "match_id": "..."} and NOT as "Ganador C1"; a group
 * stage is named "A", not "Grupo A". Rendering is the UI's job, through i18n.
 *
 * This matters beyond tidiness. Fixtures are generated once, by an organiser, in
 * whatever language they happen to be using — but the public page is read by
 * 20-60 players who each have their own. Baking the generator's language into
 * the row would make the draw sheet permanently monolingual, and it would do so
 * invisibly, because it looks correct to whoever created it.
 *
 * Note this diverges from the example in 0001_init.sql, which shows a "label"
 * key alongside kind and match_id. get_public_tournament() currently exposes
 * that label directly as `homeLabel`. Milestone 4 needs a migration to expose
 * `kind` and the reference instead, so the public page can translate. Writing
 * the label now would only make that migration harder to do later.
 *
 * ── Ids are assigned here, before insertion ──────────────────────────────────
 * Match rows reference each other ("the winner of this other match"), so the
 * uuids must exist before any row is built. Generating them client-side turns
 * what would be an insert-then-update round trip into one batch, and keeps this
 * function pure.
 */

import type { Fixture, GeneratedMatch, Slot } from '~/engine'
import type { Database, TournamentFormat } from '~/data/supabase/database.types'

type StageInsert = Database['public']['Tables']['stages']['Insert']
type RoundInsert = Database['public']['Tables']['rounds']['Insert']
type MatchInsert = Database['public']['Tables']['matches']['Insert']

export interface FixtureRows {
  readonly stages: readonly StageInsert[]
  readonly rounds: readonly RoundInsert[]
  readonly matches: readonly MatchInsert[]
}

export interface BuildFixtureRowsOptions {
  readonly tournamentId: string
  readonly format: TournamentFormat
  readonly fixture: Fixture
  /** Injectable so tests get stable ids. Defaults to crypto.randomUUID(). */
  readonly newId?: () => string
}

/**
 * A stage per bracket side, and a stage per group.
 *
 * Groups get one stage each rather than sharing a single "group stage" row,
 * because `matches` has no group column — the stage is the only thing that can
 * carry which group a match belongs to.
 */
function stageKeyOf(match: GeneratedMatch): string {
  return match.side === 'group' ? `group:${match.group ?? UNGROUPED}` : `side:${match.side}`
}

/**
 * Stage name for a group-shaped stage that has no group label.
 *
 * A plain round robin emits side 'group' with `group` undefined — it is one
 * implicit group containing everybody. Without this the name would be the empty
 * string, which `stages.name` (NOT NULL) would happily accept and no reader
 * could interpret.
 */
const UNGROUPED = 'main'

/**
 * Which stage_kind a stage key maps to.
 *
 * `round_robin` maps to 'group', not for want of a better option but because a
 * round robin IS a single group in which everyone plays everyone — the schema's
 * three kinds describe shapes, not formats.
 */
function stageKindOf(
  match: GeneratedMatch,
  format: TournamentFormat,
): Database['public']['Enums']['stage_kind'] {
  if (match.side === 'group') return 'group'
  if (format === 'swiss') return 'swiss'
  if (format === 'round_robin') return 'group'
  return 'knockout'
}

/** Language-neutral stage name: the group letter, or the bracket side. */
function stageNameOf(match: GeneratedMatch): string {
  return match.side === 'group' ? (match.group ?? UNGROUPED) : match.side
}

/**
 * Converts a slot into the pair of columns that represent it.
 *
 * A participant slot fills the FK. Everything else fills the jsonb source and
 * leaves the FK null — including 'bye', which is recorded explicitly rather than
 * as an absence so that "nobody is here yet" and "nobody is ever coming" stay
 * distinguishable on the draw sheet.
 */
function slotToColumns(
  slot: Slot,
  idFor: (engineMatchId: string) => string,
): { participantId: string | null; source: Database['public']['Tables']['matches']['Row']['home_source'] } {
  switch (slot.kind) {
    case 'participant':
      return { participantId: slot.participantId, source: null }
    case 'bye':
      return { participantId: null, source: { kind: 'bye' } }
    case 'winnerOf':
      return { participantId: null, source: { kind: 'winner_of', match_id: idFor(slot.matchId) } }
    case 'loserOf':
      return { participantId: null, source: { kind: 'loser_of', match_id: idFor(slot.matchId) } }
    case 'groupPosition':
      return {
        participantId: null,
        source: { kind: 'group_position', group: slot.group, position: slot.position },
      }
  }
}

export function buildFixtureRows({
  tournamentId,
  format,
  fixture,
  newId = () => crypto.randomUUID(),
}: BuildFixtureRowsOptions): FixtureRows {
  // Pass 1: every match gets its uuid up front, so cross-references resolve.
  const matchIds = new Map<string, string>()
  for (const match of fixture.matches) {
    matchIds.set(match.id, newId())
  }
  const idFor = (engineMatchId: string): string => {
    const id = matchIds.get(engineMatchId)
    if (id === undefined) {
      // A slot referencing a match outside the fixture means the generator and
      // this mapper disagree. Failing loudly beats writing a dangling reference
      // that only surfaces when a bracket refuses to advance.
      throw new Error(`Fixture references unknown match "${engineMatchId}"`)
    }
    return id
  }

  // Pass 2: stages, in first-appearance order.
  const stageIds = new Map<string, string>()
  const stages: StageInsert[] = []
  for (const match of fixture.matches) {
    const key = stageKeyOf(match)
    if (stageIds.has(key)) continue
    const id = newId()
    stageIds.set(key, id)
    stages.push({
      id,
      tournament_id: tournamentId,
      kind: stageKindOf(match, format),
      name: stageNameOf(match),
      sort_order: stages.length,
    })
  }

  // Pass 3: rounds, keyed by stage and the engine's round number.
  const roundIds = new Map<string, string>()
  const rounds: RoundInsert[] = []
  for (const match of fixture.matches) {
    const stageId = stageIds.get(stageKeyOf(match))
    const key = `${stageId ?? ''}:${String(match.round)}`
    if (roundIds.has(key)) continue
    const id = newId()
    roundIds.set(key, id)
    rounds.push({
      id,
      stage_id: stageId ?? '',
      idx: match.round,
      // Left null on purpose: the round's display name is derived from its index
      // and the stage kind at render time (the engine's knockoutRoundLabel does
      // exactly this), so it can be shown in the reader's language.
      name: null,
    })
  }

  // Pass 4: matches.
  const matches: MatchInsert[] = fixture.matches.map((match) => {
    const stageId = stageIds.get(stageKeyOf(match))
    const home = slotToColumns(match.home, idFor)
    const away = slotToColumns(match.away, idFor)

    return {
      id: idFor(match.id),
      tournament_id: tournamentId,
      stage_id: stageId ?? null,
      round_id: roundIds.get(`${stageId ?? ''}:${String(match.round)}`) ?? null,
      home_participant_id: home.participantId,
      away_participant_id: away.participantId,
      home_source: home.source,
      away_source: away.source,
      // A bye is finished the moment it is created — nobody plays it. Marking it
      // 'pending' would leave it sitting in every "matches still to play" count
      // for the whole tournament.
      status: match.home.kind === 'bye' || match.away.kind === 'bye' ? 'bye' : 'pending',
      // Requires 0002_match_condition.sql. Dropping this would persist the
      // double-elimination decider as an ordinary pending match, showing a
      // fixture that must be played even when the winners-bracket finalist has
      // already taken the title without losing twice.
      condition:
        match.condition === undefined
          ? null
          : { kind: 'if_away_won', match_id: idFor(match.condition.matchId) },
    }
  })

  return { stages, rounds, matches }
}
