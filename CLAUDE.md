# Cuadro — working notes

Tournament and league management for amateur sport in Spain. Padel first, plus
football 7, basketball and chess.

An organiser creates a tournament, adds participants, picks a format, and the app
generates the whole fixture list deterministically. They share **one** public
link. Players open it on a phone — no account, no install — and see when they
play, against whom, on which court. Results go in; standings and brackets update.

> **Naming:** the folder is `Ronda`, the code says `Cuadro`. This is unresolved —
> see "Open decisions" below. Do not rename anything without asking.

---

## Hard constraints — do not violate

1. **Web only.** No native app.
2. **Free to host.** Static frontend on Cloudflare Pages + Supabase free tier.
   Nothing that costs money before there are paying users.
3. **No AI/LLM at runtime.** Every feature is a deterministic algorithm. Fixture
   generation is classic computer science, not a model call.
4. **The public tournament page must work with no account** and be fast on bad
   4G. It is the storefront: every tournament exposes it to 20–60 people.
5. **Mobile-first.** Most viewers are on phones, outdoors, in sunlight.
6. **Spanish first, English second.** No hardcoded strings, ever.

---

## Commands

```bash
npm run dev         # dev server
npm run typecheck   # all four tsconfigs
npm run test        # vitest, three projects
npm run lint        # eslint + stylelint
npm run build       # vite build + secret scan
npm run verify      # all of the above
```

Always run `npm run verify` before declaring work done, and report what actually
ran rather than assuming.

---

## Stack (all versions pinned exactly)

React 19.2.7 · Vite 8.1.5 (**Rolldown/Oxc**, not esbuild/Rollup) · TypeScript
6.0.3 · Vitest 4.1.10 · React Router 7.18.1 (**data mode**) · supabase-js
2.110.7 · i18next 26.3.6.

**TypeScript 6, not 7**, deliberately: TS 7 shipped 2026-07-08 but
`typescript-eslint` peers `<6.1.0`, so type-aware linting is unavailable — and
ESLint is the enforcement mechanism for the boundaries below. `tsconfig.json`
already applies TS 7's defaults so the eventual upgrade is a version bump.

Version-specific traps that fail silently:

- `build.rollupOptions` → **`build.rolldownOptions`**. `manualChunks` → `advancedChunks.groups`. Never set the `esbuild` key.
- Vitest 4 removed `workspace`; use `test.projects`.
- React 19 has no `forwardRef` — `ref` is a normal prop.
- Cloudflare Pages needs `NODE_VERSION=22.12` or the build fails obscurely.

---

## Enforced boundaries — the load-bearing part

Each of these was verified by deliberately introducing a violation and
confirming the failure. Do not weaken them.

| Boundary | Enforced by |
| --- | --- |
| `src/engine/` is pure — no React, network, DOM or Supabase | `tsconfig.engine.json` omits the `DOM` lib, so `window`/`fetch` are **compile errors**; plus ESLint import bans; plus a node-environment Vitest project |
| Public route never reaches auth or supabase-js | ESLint `no-restricted-imports` **and** `src/test/publicBoundary.test.ts`, which walks the real import graph to catch the transitive case lint cannot see |
| No hardcoded user-facing strings | Typed i18n keys (`src/i18n/resources.d.ts`) make a bad key a compile error |
| No colour literals outside `src/styles/tokens/` | stylelint `declaration-property-value-disallowed-list` |
| No secrets in the bundle | `scripts/check-no-secrets.mjs` decodes JWTs and checks the `role` claim |
| Public page stays server-renderable | `*.ssr.test.tsx` renders it with `renderToString` in a DOM-less environment |

**Never use `Math.random()` in `src/engine/`.** Draws must be reproducible from
`tournaments.draw_seed` so a disputed bracket can be regenerated identically.
Use `createRng()` in `src/engine/rng.ts`.

---

## Gotchas already paid for

- **CSS Modules `camelCaseOnly` merges keyframe and class namespaces.** A
  keyframe `live-window` and a class `.liveWindow` both export as `liveWindow`,
  and one silently overwrites the other — the animation just never runs, with no
  error. All keyframes are prefixed `kf-`. Keep doing that.
- **Never `await` a Supabase call inside `onAuthStateChange`** — it runs inside
  GoTrue's navigator lock and deadlocks. Defer with `setTimeout(fn, 0)`.
- **PL/pgSQL `SELECT ... INTO a, b` assigns one column per target.** `select m.*,
  t.club_id into v_match, v_club` is broken and only fails at call time.
- **The Supabase SQL editor does not wrap scripts in a transaction.** A failure
  mid-script leaves everything before it committed. `0001_init.sql` is fully
  idempotent; keep it that way.
- The anon key is **public by design**. Safety is RLS. Do not "fix" it.

---

## Design system: "Pista"

Grounded in the padel court. Deep court blue `#0B3B6F`, white line markings,
optic yellow `#D8F034` reserved **exclusively** for live/in-progress state.

Tokens layer **primitives → semantic → component** (`src/styles/tokens/`).
Components speak only `--color-*`, never `--c-*`. That indirection is what makes
per-club branding (milestone 7) a single `<style>` injection rather than a
refactor.

Sunlight rules, treated as functional requirements:

- Body text at **7:1** (AAA), not 4.5:1. Body **17px**, not 16px.
- Muted text never below weight 500. **There is no 1px border option** —
  hairlines are invisible outdoors.
- Meaning is never carried by colour alone.
- Touch targets ≥48px.
- **The public page and landing page are permanently light** and do not follow
  `prefers-color-scheme` — dark themes wash out under bright ambient light. Only
  the organiser app (used indoors) honours the OS setting.

---

## Current state

- ✅ **Milestone 1** — scaffold, tokens, i18n, auth, RLS migration, deploy config
- ✅ **Milestone 2** — scheduling engine, 341 engine tests
- ✅ **Landing page** — built out of order, at the user's request
- ⬜ **Milestones 3–7** — see `ROADMAP.md`

350 tests passing. Typecheck, lint and build all clean.

**Blocked on the user:** `supabase/migrations/0001_init.sql` has not been applied
to the live Supabase project — `get_public_tournament` returns 404. Nothing that
touches the database works until it is run.

## Open decisions

- **The name.** `Ronda` (folder) vs `Cuadro` (code). Recommendation is Ronda:
  "cuadro" is the generic Spanish word for a draw sheet, which makes it
  ambiguous in conversation, hard to trademark and hard to search. Rename is
  ~30 minutes now and expensive once real tournaments exist.
