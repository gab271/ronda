import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join, dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ARCHITECTURAL BOUNDARY TEST — the public tournament page must not reach
 * supabase-js or any auth code, transitively.
 *
 * Why this exists when eslint.config.js already forbids those imports: a lint
 * rule only sees the file it is linting. It catches
 *
 *     routes/public/Foo.tsx → @supabase/supabase-js          (direct, caught)
 *
 * but not
 *
 *     routes/public/Foo.tsx → ui/Thing.tsx → data/supabase/client.ts
 *                                                            (transitive, missed)
 *
 * and the transitive case is the one that actually happens — someone adds a
 * convenient helper to a shared module months from now. This test walks the real
 * import graph from the public route's entry points and fails if it ever reaches
 * forbidden territory.
 *
 * What breaks if this regresses: the public page gains ~40KB gzip on the
 * storefront's critical path, AND — worse — a signed-in organiser previewing
 * their public link gets a session token attached to the request, so RLS
 * evaluates as `authenticated` and they see a page no player would see.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ENTRY_POINTS = [
  'routes/public/PublicTournamentRoute.tsx',
  'routes/public/publicLoader.ts',
]

const FORBIDDEN = [
  { match: (spec: string) => spec.startsWith('@supabase/'), label: '@supabase/* (bundle size + attaches a user JWT)' },
  { match: (spec: string) => spec.includes('data/supabase'), label: 'the authenticated Supabase client' },
  { match: (spec: string) => spec.includes('features/auth'), label: 'auth feature code' },
]

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

async function resolveModule(spec: string, fromFile: string): Promise<string | null> {
  let base: string
  if (spec.startsWith('~/')) {
    base = join(SRC, spec.slice(2))
  } else if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec)
  } else {
    return null // bare package specifier — not a file we walk into
  }

  if (extname(base) !== '') {
    return base
  }
  for (const ext of ['.ts', '.tsx']) {
    const candidate = `${base}${ext}`
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch {
      continue
    }
  }
  for (const ext of ['.ts', '.tsx']) {
    const candidate = join(base, `index${ext}`)
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch {
      continue
    }
  }
  return null
}

async function collectGraph(entry: string): Promise<{ files: Set<string>; specs: Map<string, string> }> {
  const files = new Set<string>()
  // specifier → the file that imported it, so a failure can name the culprit.
  const specs = new Map<string, string>()
  const queue = [join(SRC, entry)]

  while (queue.length > 0) {
    const file = queue.pop()
    if (!file || files.has(file)) continue

    let contents: string
    try {
      contents = await readFile(file, 'utf8')
    } catch {
      continue
    }
    files.add(file)

    for (const match of contents.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2]
      if (!spec) continue
      if (!specs.has(spec)) specs.set(spec, file)

      const resolved = await resolveModule(spec, file)
      if (resolved && !files.has(resolved)) {
        queue.push(resolved)
      }
    }
  }

  return { files, specs }
}

describe('public route import boundary', () => {
  it.each(ENTRY_POINTS)('%s does not transitively reach auth or supabase-js', async (entry) => {
    const { specs, files } = await collectGraph(entry)

    // Sanity check: if resolution silently failed we would be asserting over an
    // almost-empty graph and proving nothing.
    expect(files.size).toBeGreaterThan(1)

    const violations: string[] = []
    for (const [spec, importer] of specs) {
      for (const { match, label } of FORBIDDEN) {
        if (match(spec)) {
          violations.push(
            `  "${spec}" imported by ${importer.replace(SRC, 'src')}\n    → forbidden: ${label}`,
          )
        }
      }
    }

    expect(violations.join('\n'), `Public route reached forbidden modules:\n${violations.join('\n')}`).toBe('')
  })
})
