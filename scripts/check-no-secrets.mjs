#!/usr/bin/env node
/**
 * Build guard: fail if a secret reached the client bundle.
 *
 * Everything in dist/ is served to anyone who loads the site. A single
 * mis-prefixed environment variable (VITE_SUPABASE_SERVICE_ROLE_KEY instead of
 * SUPABASE_SERVICE_ROLE_KEY) silently publishes a key that bypasses every RLS
 * policy in the database. There is no runtime symptom — the app works fine.
 *
 * ── Why this decodes JWTs instead of grepping for "service_role" ────────────
 * The obvious implementation — grep dist/ for the string "service_role" —
 * produces false positives immediately, and did: it matched the validation code
 * in src/lib/env.ts (which mentions the string in order to reject it) and
 * supabase-js's own sourcemap. A guard that cries wolf on every build gets
 * disabled within a week, which is worse than having no guard at all.
 *
 * So instead we find JWT-shaped tokens, decode the payload, and check the actual
 * `role` claim. That matches real keys and only real keys.
 *
 * Note: the anon/publishable key IS expected in dist/ and is not flagged — it
 * authorises nothing and all access control lives in RLS. See src/lib/env.ts.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import process from 'node:process'
import { Buffer } from 'node:buffer'

const DIST = 'dist'
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map'])

/** Roles that must never appear in a token shipped to the browser. */
const FORBIDDEN_ROLES = new Set(['service_role', 'supabase_admin'])

/** JWTs: three base64url segments separated by dots, starting with the standard header. */
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g

/** Non-JWT secrets, matched literally because they have distinctive prefixes. */
const LITERAL_PATTERNS = [
  {
    label: 'Supabase secret key (sb_secret_…) — bypasses Row Level Security',
    pattern: /sb_secret_[A-Za-z0-9_-]{8,}/,
  },
  {
    label: 'Postgres connection string with embedded credentials',
    pattern: /postgres(?:ql)?:\/\/[^:\s"']+:[^@\s"']+@/,
  },
  { label: 'Stripe live secret key', pattern: /\bsk_live_[A-Za-z0-9]{8,}/ },
  { label: 'Stripe restricted key', pattern: /\brk_live_[A-Za-z0-9]{8,}/ },
  {
    label: 'Private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
]

/**
 * Decodes a JWT payload. Returns null for anything that is not actually a JWT —
 * base64url-looking strings turn up in bundles for unrelated reasons.
 */
function decodeJwtPayload(token) {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8')
    const parsed = JSON.parse(json)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`check-no-secrets: ${dir}/ not found. Run this after "vite build", not before.`)
      process.exit(1)
    }
    throw error
  }

  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (SCANNED_EXTENSIONS.has(extname(entry.name))) {
      yield full
    }
  }
}

const findings = []
let scanned = 0
let jwtsInspected = 0

for await (const file of walk(DIST)) {
  scanned += 1
  const contents = await readFile(file, 'utf8')

  for (const { label, pattern } of LITERAL_PATTERNS) {
    if (pattern.test(contents)) {
      findings.push({ file, label })
    }
  }

  for (const token of contents.match(JWT_RE) ?? []) {
    const payload = decodeJwtPayload(token)
    if (!payload) continue
    jwtsInspected += 1
    if (typeof payload.role === 'string' && FORBIDDEN_ROLES.has(payload.role)) {
      findings.push({
        file,
        label: `JWT with role="${payload.role}" — bypasses Row Level Security`,
      })
    }
  }
}

// The same key typically appears several times in one chunk (and again in its
// sourcemap). Report each distinct problem once so the output stays readable.
const unique = [...new Map(findings.map((f) => [`${f.file}::${f.label}`, f])).values()]

if (unique.length > 0) {
  console.error('\n  BUILD FAILED — secret material found in the client bundle\n')
  for (const { file, label } of unique) {
    console.error(`  ${file}`)
    console.error(`    → ${label}\n`)
  }
  console.error('  Anything in dist/ is public. Remove the VITE_ prefix from that')
  console.error('  variable — only VITE_-prefixed vars are bundled — then rebuild.\n')
  process.exit(1)
}

console.log(
  `check-no-secrets: scanned ${scanned} files in ${DIST}/ ` +
    `(${jwtsInspected} JWT${jwtsInspected === 1 ? '' : 's'} inspected), no secrets found.`,
)
