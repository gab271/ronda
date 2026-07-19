/**
 * Every authenticated tournament write.
 *
 * ORGANISER PATH ONLY — this imports the authenticated Supabase client and must
 * never be reachable from the public route. See eslint.config.js.
 *
 * ⚠ NOT YET EXERCISED AGAINST A LIVE DATABASE. The functions below are typed
 * against the real schema and unit-tested against a mocked client, which proves
 * the call shapes and the branching but NOT that RLS admits them. `report_score`
 * in 0001_init.sql is the cautionary tale: its PL/pgSQL was correct by
 * reasoning and still carried a bug that only a real call could surface. Treat
 * this file as unverified until someone has created a tournament for real.
 */

import { supabase } from '~/data/supabase/client'
import { generatePublicSlug } from '~/lib/slug'
import type { Database, Json, Sport, TournamentFormat } from '~/data/supabase/database.types'
import { buildFixtureRows } from './fixtureRows'
import { generateFixtureForFormat, type FixtureConfig } from './generateFixture'
import type { ParsedParticipant } from './parseParticipants'

type TournamentRow = Database['public']['Tables']['tournaments']['Row']
type ParticipantRow = Database['public']['Tables']['participants']['Row']

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505'

export class RepoError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RepoError'
    this.code = code
  }
}

/**
 * The club the signed-in user organises for.
 *
 * handle_new_user() gives every account a personal club at sign-up, so this
 * resolves for any real user. It returning nothing means the trigger did not
 * run — worth surfacing loudly rather than failing later on a null club_id.
 */
export async function getCurrentClubId(): Promise<string> {
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) throw new RepoError('not_signed_in', 'No signed-in user.')

  const { data, error } = await supabase
    .from('club_members')
    .select('club_id')
    .eq('user_id', auth.user.id)
    .in('role', ['owner', 'admin'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new RepoError('club_lookup_failed', error.message)
  if (!data) {
    throw new RepoError(
      'no_club',
      'This account has no club. handle_new_user() should have created one at sign-up.',
    )
  }
  return data.club_id
}

export interface CreateTournamentInput {
  readonly name: string
  readonly sport: Sport
  readonly format: TournamentFormat
  /** IANA zone. Atlantic/Canary is an hour off Europe/Madrid and both are Spain. */
  readonly timezone: string
  readonly startsOn?: string | null
  readonly endsOn?: string | null
  readonly config?: FixtureConfig
}

/**
 * Creates a draft tournament.
 *
 * The slug is minted HERE, not at publish. `public_slug` is NOT NULL, so a
 * draft cannot exist without one — and because it is opaque and unguessable, a
 * draft carrying a slug is not exposed by it: get_public_tournament() refuses
 * any status other than published/in_progress/finished.
 *
 * draw_seed is left to the column default so the server decides it. A client-
 * chosen seed would let an organiser re-roll a draw until they liked it and
 * still present it as reproducible.
 */
export async function createTournament(input: CreateTournamentInput): Promise<TournamentRow> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new RepoError('not_signed_in', 'No signed-in user.')
  const clubId = await getCurrentClubId()

  // 32^10 makes a collision vanishingly unlikely, but "vanishingly unlikely"
  // against a UNIQUE constraint is still an error an organiser would see. Retry
  // rather than surface it.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from('tournaments')
      .insert({
        club_id: clubId,
        created_by: auth.user.id,
        name: input.name.trim(),
        sport: input.sport,
        format: input.format,
        timezone: input.timezone,
        starts_on: input.startsOn ?? null,
        ends_on: input.endsOn ?? null,
        public_slug: generatePublicSlug(),
        // FixtureConfig has optional properties, which are not structurally
        // assignable to Json's index signature. The value is a plain object of
        // primitives, so the cast is safe and narrower than `any`.
        config: (input.config ?? {}) as Json,
      })
      .select()
      .single()

    if (!error) return data
    if (error.code !== UNIQUE_VIOLATION) throw new RepoError('create_failed', error.message)
  }

  throw new RepoError('slug_collision', 'Could not mint a unique public slug.')
}

export async function listTournaments(): Promise<TournamentRow[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select()
    .order('created_at', { ascending: false })

  if (error) throw new RepoError('list_failed', error.message)
  return data
}

export async function getTournament(id: string): Promise<TournamentRow> {
  const { data, error } = await supabase.from('tournaments').select().eq('id', id).single()
  if (error) throw new RepoError('not_found', error.message)
  return data
}

export async function listParticipants(tournamentId: string): Promise<ParticipantRow[]> {
  const { data, error } = await supabase
    .from('participants')
    .select()
    .eq('tournament_id', tournamentId)
    .order('seed', { ascending: true, nullsFirst: false })
    .order('display_name', { ascending: true })

  if (error) throw new RepoError('list_failed', error.message)
  return data
}

/**
 * Replaces the whole entry list.
 *
 * Replace rather than merge, because the source of truth is the organiser's
 * pasted list: if they remove a pair from it and paste again, they mean that
 * pair has withdrawn. Merging would silently keep entrants they had deleted.
 *
 * Refuses once fixtures exist. Participants are referenced by matches, so
 * changing the field under a generated draw would leave matches pointing at
 * deleted rows (the FK is ON DELETE SET NULL, so they would go quietly blank
 * rather than error).
 */
export async function replaceParticipants(
  tournamentId: string,
  parsed: readonly ParsedParticipant[],
): Promise<ParticipantRow[]> {
  const { count, error: countError } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)

  if (countError) throw new RepoError('count_failed', countError.message)
  if ((count ?? 0) > 0) {
    throw new RepoError(
      'fixtures_exist',
      'Fixtures have already been generated. Regenerate them after changing the entry list.',
    )
  }

  const { error: deleteError } = await supabase
    .from('participants')
    .delete()
    .eq('tournament_id', tournamentId)
  if (deleteError) throw new RepoError('replace_failed', deleteError.message)

  if (parsed.length === 0) return []

  const { data, error } = await supabase
    .from('participants')
    .insert(
      parsed.map((p) => ({
        tournament_id: tournamentId,
        kind: p.kind,
        display_name: p.displayName,
        seed: p.seed,
      })),
    )
    .select()

  if (error) throw new RepoError('replace_failed', error.message)

  // Contact details go in participant_members, which get_public_tournament()
  // never reads. That separation is why a public draw sheet physically cannot
  // leak a phone number.
  const members = parsed.flatMap((p, index) => {
    const row = data[index]
    if (!row) return []
    return p.memberNames.map((name) => ({ participant_id: row.id, name }))
  })

  if (members.length > 0) {
    const { error: memberError } = await supabase.from('participant_members').insert(members)
    if (memberError) throw new RepoError('replace_failed', memberError.message)
  }

  return data
}

/** How many matches already carry a result. Zero means regenerating is free. */
export async function countEnteredResults(tournamentId: string): Promise<number> {
  const { count, error } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .not('score', 'is', null)

  if (error) throw new RepoError('count_failed', error.message)
  return count ?? 0
}

export interface GenerateFixturesOptions {
  /** Required once results exist — regenerating discards them. */
  readonly force?: boolean
}

/**
 * Generates and persists the fixture list.
 *
 * Refuses to overwrite entered results unless forced. The roadmap calls for a
 * warning; this makes it a refusal the UI must consciously override, because
 * the cost is asymmetric — a regenerated draw discards scores that were entered
 * courtside and cannot be reconstructed from anything.
 */
export async function generateAndPersistFixtures(
  tournamentId: string,
  options: GenerateFixturesOptions = {},
): Promise<{ matchCount: number }> {
  const tournament = await getTournament(tournamentId)
  const participants = await listParticipants(tournamentId)

  if (participants.length < 2) {
    throw new RepoError('too_few_participants', 'At least two participants are needed.')
  }

  if (!options.force) {
    const entered = await countEnteredResults(tournamentId)
    if (entered > 0) {
      throw new RepoError(
        'results_exist',
        `${String(entered)} result(s) already entered. Regenerating discards them.`,
      )
    }
  }

  const fixture = generateFixtureForFormat({
    format: tournament.format,
    participants: participants
      .filter((p) => !p.withdrawn)
      .map((p) => ({ id: p.id, seed: p.seed })),
    drawSeed: tournament.draw_seed,
    config: (tournament.config ?? {}) as FixtureConfig,
  })

  const rows = buildFixtureRows({
    tournamentId,
    format: tournament.format,
    fixture,
  })

  // Matches first: they reference stages, and deleting a stage cascades, but a
  // match whose stage_id is null would survive and orphan the tournament.
  const { error: matchDeleteError } = await supabase
    .from('matches')
    .delete()
    .eq('tournament_id', tournamentId)
  if (matchDeleteError) throw new RepoError('generate_failed', matchDeleteError.message)

  const { error: stageDeleteError } = await supabase
    .from('stages')
    .delete()
    .eq('tournament_id', tournamentId)
  if (stageDeleteError) throw new RepoError('generate_failed', stageDeleteError.message)

  const { error: stageError } = await supabase.from('stages').insert([...rows.stages])
  if (stageError) throw new RepoError('generate_failed', stageError.message)

  const { error: roundError } = await supabase.from('rounds').insert([...rows.rounds])
  if (roundError) throw new RepoError('generate_failed', roundError.message)

  const { error: matchError } = await supabase.from('matches').insert([...rows.matches])
  if (matchError) throw new RepoError('generate_failed', matchError.message)

  return { matchCount: rows.matches.length }
}

/**
 * Publishes a draft.
 *
 * Only flips status and stamps published_at — the slug already exists and does
 * NOT change, so a link shared before publishing keeps working afterwards.
 */
export async function publishTournament(tournamentId: string): Promise<TournamentRow> {
  const { count, error: countError } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)

  if (countError) throw new RepoError('count_failed', countError.message)
  if ((count ?? 0) === 0) {
    // A published tournament with no fixtures is the worst possible storefront:
    // players open the shared link and find an empty page.
    throw new RepoError('no_fixtures', 'Generate the fixtures before publishing.')
  }

  const { data, error } = await supabase
    .from('tournaments')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', tournamentId)
    .select()
    .single()

  if (error) throw new RepoError('publish_failed', error.message)
  return data
}
