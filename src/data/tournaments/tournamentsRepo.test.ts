import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Covers the REFUSALS, which is where the damage lives.
 *
 * These do not prove RLS admits the queries — only a live database can do that,
 * and this file is explicit that it has not. What they do prove is that the
 * guards fire, because every one of them protects something irreversible:
 * results entered courtside, a shared link that opens on an empty page, an
 * entry list changed under a draw that already references it.
 */

interface QueryResult {
  data?: unknown
  error?: { message: string; code?: string } | null
  count?: number
}

/** Minimal stand-in for supabase-js's chainable builder. */
function query(result: QueryResult) {
  const resolved = { data: null, error: null, count: 0, ...result }
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'order', 'limit']) {
    builder[method] = () => builder
  }
  builder['single'] = () => Promise.resolve(resolved)
  builder['maybeSingle'] = () => Promise.resolve(resolved)
  builder['then'] = (onFulfilled: (value: unknown) => unknown, onRejected?: (r: unknown) => unknown) =>
    Promise.resolve(resolved).then(onFulfilled, onRejected)
  return builder
}

/** Queued per-table responses, consumed in call order. */
const responses = new Map<string, QueryResult[]>()

function enqueue(table: string, ...results: QueryResult[]) {
  responses.set(table, [...(responses.get(table) ?? []), ...results])
}

const from = vi.fn((table: string) => {
  const queued = responses.get(table)
  const next = queued?.shift()
  return query(next ?? { data: [], error: null, count: 0 })
})

const getUser = vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }))

vi.mock('~/data/supabase/client', () => ({
  supabase: {
    from: (table: string) => from(table),
    auth: { getUser: () => getUser() },
  },
}))

const { RepoError, generateAndPersistFixtures, publishTournament, replaceParticipants } =
  await import('./tournamentsRepo')

beforeEach(() => {
  responses.clear()
  from.mockClear()
})

describe('publishTournament', () => {
  it('refuses to publish a tournament with no fixtures', async () => {
    // A published tournament with no matches is the worst possible storefront:
    // 20-60 people open the shared link and find an empty page.
    enqueue('matches', { count: 0 })

    await expect(publishTournament('t-1')).rejects.toMatchObject({
      name: 'RepoError',
      code: 'no_fixtures',
    })
  })

  it('publishes when fixtures exist', async () => {
    enqueue('matches', { count: 12 })
    enqueue('tournaments', { data: { id: 't-1', status: 'published' } })

    await expect(publishTournament('t-1')).resolves.toMatchObject({ status: 'published' })
  })
})

describe('generateAndPersistFixtures', () => {
  it('refuses to discard entered results', async () => {
    enqueue('tournaments', {
      data: { id: 't-1', format: 'single_elim', draw_seed: 42, config: {} },
    })
    enqueue('participants', {
      data: [
        { id: 'p1', seed: null, withdrawn: false },
        { id: 'p2', seed: null, withdrawn: false },
      ],
    })
    enqueue('matches', { count: 3 })

    // A regenerated draw discards scores entered courtside, which cannot be
    // reconstructed from anything. Refusal, not a warning to click past.
    await expect(generateAndPersistFixtures('t-1')).rejects.toMatchObject({
      code: 'results_exist',
    })
  })

  it('regenerates when explicitly forced', async () => {
    enqueue('tournaments', {
      data: { id: 't-1', format: 'single_elim', draw_seed: 42, config: {} },
    })
    enqueue('participants', {
      data: [
        { id: 'p1', seed: null, withdrawn: false },
        { id: 'p2', seed: null, withdrawn: false },
      ],
    })

    const result = await generateAndPersistFixtures('t-1', { force: true })
    expect(result.matchCount).toBeGreaterThan(0)
  })

  it('refuses a field of fewer than two', async () => {
    enqueue('tournaments', {
      data: { id: 't-1', format: 'single_elim', draw_seed: 42, config: {} },
    })
    enqueue('participants', { data: [{ id: 'p1', seed: null, withdrawn: false }] })

    await expect(generateAndPersistFixtures('t-1')).rejects.toMatchObject({
      code: 'too_few_participants',
    })
  })

  it('excludes withdrawn participants from the draw', async () => {
    enqueue('tournaments', {
      data: { id: 't-1', format: 'round_robin', draw_seed: 1, config: {} },
    })
    enqueue('participants', {
      data: [
        { id: 'p1', seed: null, withdrawn: false },
        { id: 'p2', seed: null, withdrawn: false },
        { id: 'p3', seed: null, withdrawn: true },
      ],
    })

    // Two active participants in a round robin is exactly one match. A third,
    // withdrawn, would make it three.
    const result = await generateAndPersistFixtures('t-1', { force: true })
    expect(result.matchCount).toBe(1)
  })
})

describe('replaceParticipants', () => {
  it('refuses once fixtures reference the entry list', async () => {
    // matches.home_participant_id is ON DELETE SET NULL, so replacing the field
    // under a generated draw would blank those sides silently rather than fail.
    enqueue('matches', { count: 8 })

    await expect(replaceParticipants('t-1', [])).rejects.toMatchObject({
      code: 'fixtures_exist',
    })
  })

  it('returns an empty list without inserting when given nothing', async () => {
    enqueue('matches', { count: 0 })
    enqueue('participants', { data: null })

    await expect(replaceParticipants('t-1', [])).resolves.toEqual([])
  })
})

describe('RepoError', () => {
  it('carries a stable code for the UI to branch on', () => {
    const error = new RepoError('results_exist', 'nope')
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('results_exist')
    expect(error.name).toBe('RepoError')
  })
})
