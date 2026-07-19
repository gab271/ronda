# Ronda

Tournament and league management for amateur sport. Padel first, plus football 7,
basketball and chess. Spanish-first.

An organiser creates a tournament, adds participants, picks a format, and Ronda
generates the whole fixture list. They share **one** link. Players open it on a
phone — no account, no install — and see when they play, against whom, on which
court.

**Status: milestone 1 (scaffold + foundation).** Sign-in works; tournament
creation, the public draw sheet and the scheduling engine are milestones 2–4.

---

## Setup

You need a Supabase project and a Cloudflare Pages project. Both are free.

### 1. Supabase

Create a project at [supabase.com](https://supabase.com).

> **Choose region `eu-west-3` (Paris).** This cannot be changed later without a
> full migration, and every millisecond of it lands on the public tournament
> page's critical path — the surface read on outdoor 4G by 20–60 people per
> tournament. Paris is the closest region to Spain.

Then apply the schema. Either paste `supabase/migrations/0001_init.sql` into the
SQL Editor, or use the CLI:

```bash
npx supabase link --project-ref <your-ref>
npx supabase db push
```

**The migration is idempotent — re-running it is safe.** That matters because the
Supabase SQL Editor does not wrap a script in a transaction: if one statement
fails, everything before it stays committed. A naive re-run then dies with
`relation "profiles" already exists` without telling you how far the first run
got. Every statement here is guarded, so a re-run fills in whatever is missing
and leaves existing data alone.

If you want a genuinely clean slate, run `supabase/migrations/reset_dev.sql`
first. **It deletes all tournament data** and is development-only.

To see what state the database is currently in:

```sql
select 'tables' as kind, string_agg(tablename, ', ' order by tablename) as found
from pg_tables where schemaname = 'public'
union all
select 'functions', string_agg(p.proname, ', ' order by p.proname)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
union all
select 'policies', count(*)::text from pg_policies where schemaname = 'public';
```

Finally, generate the real database types (the committed file is a hand-written
placeholder covering only what milestone 1 touches):

```bash
npx supabase gen types typescript --project-id <your-ref> > src/data/supabase/database.types.ts
```

### 2. Local environment

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
**Project Settings → Data API**.

The anon key is **meant to be public**. It identifies the project and authorises
nothing; all access control is in the RLS policies. Do not try to hide it — doing
so would break the public tournament page, which must work with no account.

What must *never* get a `VITE_` prefix: the `service_role` key, the Postgres
connection string, SMTP credentials, payment secrets. `npm run build` decodes
every JWT in `dist/` and fails if one carries a privileged role.

```bash
npm install
npm run dev
```

### 3. Cloudflare Pages

Create a Pages project from this repo.

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| `NODE_VERSION` | `22.12` |
| `VITE_SUPABASE_URL` | your project URL |
| `VITE_SUPABASE_ANON_KEY` | your anon key |

> `NODE_VERSION` is not optional. Vite 8 requires `^20.19 || >=22.12`, the default
> Pages image is older, and the resulting error message does not mention Node.

`public/_redirects` handles the SPA fallback — without it, a player opening a
shared `/t/<slug>` link cold from WhatsApp (which is the only way anyone ever
reaches that page) gets a 404 from the static host.

### 4. Before any real use

Two free-tier behaviours that are invisible in development and damaging in
production:

- **Supabase pauses projects after ~7 days of inactivity.** A shared tournament
  link that errors because the database is asleep is the worst possible failure
  for the product's storefront. Add a Cloudflare Cron Trigger (free) that pings
  the project daily.
- **Supabase's built-in SMTP is limited to ~2–4 emails/hour** and is explicitly
  not for production. Configure a real provider (Resend or Brevo, both free at
  this volume) before inviting anyone. This is also why sign-in is email +
  password rather than magic link — a magic-link-only product breaks the moment
  two organisers sign up in the same hour.

### 5. Fonts

The design uses [Archivo](https://fonts.google.com/specimen/Archivo) (variable,
self-hosted). Until the file is added, the app falls back to `system-ui`, which
is a supported state — every rule names a fallback.

To add it, put a subsetted variable woff2 at `public/fonts/archivo-variable-latin.woff2`:

```bash
npx glyphhanger --subset=Archivo-Variable.ttf --formats=woff2 --US_ASCII \
  --whitelist="áéíóúüñÁÉÍÓÚÜÑ¿¡·ºª—…"
```

Self-hosted rather than CDN-loaded: no third-party handshake on the critical
path, no dependency on a service that could disappear, and Cloudflare serves it
from an already-warm connection.

---

## Commands

```bash
npm run dev         # dev server
npm run build       # typecheck-free build + secret scan
npm run typecheck   # all four tsconfigs
npm run test        # vitest, three projects
npm run lint        # eslint + stylelint
npm run verify      # everything above
```

---

## Architecture

### The public page is the product

Every tournament exposes `/t/<slug>` to 20–60 people, on phones, outdoors, on bad
4G. Three decisions follow from that, and they are load-bearing rather than
stylistic:

**The public route does not import `@supabase/supabase-js`.**
`src/data/public/publicClient.ts` is a ~40-line `fetch` wrapper instead. Three
reasons, in order of importance:

1. *Correctness.* supabase-js attaches the signed-in user's JWT. An organiser
   previewing their own link would get RLS evaluated as `authenticated` and could
   see a page no player sees. The fetch client sends only the anon key, so the
   page renders identically for everyone.
2. *Portability.* It runs unmodified in a Cloudflare Worker. That is milestone
   4's edge-rendering data layer, already written.
3. *Size.* 51 kB gzip saved on the storefront — measured, not estimated.

Enforced two ways: an ESLint rule bans the import, and
`src/test/publicBoundary.test.ts` walks the real import graph to catch the
*transitive* case that lint cannot see.

**Anonymous reads never touch tables.** One `SECURITY DEFINER` function,
`get_public_tournament(slug)`, is the entire anonymous surface of the database.
It is one round trip instead of four, it is one cacheable URL for milestone 4,
and — most importantly — it shapes its own output, so participant emails and
phone numbers physically cannot leak. With table-level anon policies we would be
one `select *` away from publishing players' phone numbers.

**No realtime on the public page.** The free tier caps at 200 concurrent
connections (60 spectators × 3 tournaments exceeds it) and WebSockets
reconnect-storm on flaky outdoor 4G. Milestone 5 polls every 25–30s, gated on
tab visibility.

### Measured baseline (milestone 1)

Public route: **~81 kB gzip** total. The supabase-js chunk (51 kB gzip) is
confirmed absent from it. The largest remaining pieces are React + React Router
(~57 kB) and i18next (~14 kB); i18next is the first optimisation target if the
public page needs to get smaller in milestone 4.

### Enforced boundaries

| Boundary | Enforced by |
| --- | --- |
| `src/engine/` is pure — no React, network, DOM or Supabase | `tsconfig.engine.json` omits the `DOM` lib, so DOM access is a **compile error**; plus ESLint import bans and a node-environment Vitest project |
| Public route never reaches auth or supabase-js | ESLint `no-restricted-imports` + a transitive import-graph test |
| No hardcoded user-facing strings | Typed i18n keys (`src/i18n/resources.d.ts`) make a bad key a compile error; `eslint-plugin-i18next` catches literals in JSX |
| No colour literals outside the token layer | stylelint `declaration-property-value-disallowed-list` |
| No secrets in the bundle | `scripts/check-no-secrets.mjs` decodes JWTs and checks the `role` claim |
| Public page stays server-renderable | `*.ssr.test.tsx` renders it with `renderToString` in a DOM-less environment |

Each of these was verified by deliberately introducing a violation and confirming
the failure, not by assuming the config was right.

### Design: "Pista"

Grounded in the padel court. A pista is a blue rectangle with hard white lines,
and those lines carry meaning — they define in and out. Ronda uses the same
device: dividers, bracket paths and table rules are court lines, solid and high
contrast. There is deliberately **no 1px border option** in the token system —
hairlines are invisible in sunlight and are the most common outdoor-legibility
failure.

Tokens layer as primitives → semantic → component
(`src/styles/tokens/`). Components speak only the semantic vocabulary
(`--color-brand`, never `--c-blue-800`), which is what makes per-club branding in
milestone 7 a single `<style>` injection rather than a refactor.

Sunlight rules, treated as functional requirements: body text at 7:1 (AAA) not
4.5:1; 17px body, not 16px; muted text never below weight 500; meaning never
carried by colour alone; 48px touch targets; `[data-contrast="high"]` shipped
from day one. **The public page is permanently light and does not follow
`prefers-color-scheme`** — under bright ambient light phones raise backlight to
maximum and dark themes wash out badly. The organiser app, used indoors, does
follow the OS.

### Stack

React 19.2.7 · Vite 8.1.5 (Rolldown/Oxc) · TypeScript 6.0.3 · Vitest 4.1.10 ·
React Router 7.18.1 (data mode) · supabase-js 2.110.7 · i18next 26.3.6.
All versions pinned exactly.

**TypeScript 6, not 7.** TS 7.0.2 shipped 2026-07-08 and its CLI is production
ready, but `typescript-eslint` peers `>=4.8.4 <6.1.0` and TS 7 has no stable
programmatic API until 7.1 — so type-aware linting is unavailable. ESLint *is*
the enforcement mechanism for the boundaries above, so that is not a trade worth
making. `tsconfig.json` already applies TS 7's defaults (`strict`,
`module: esnext`, explicit `types`, no `baseUrl`, `erasableSyntaxOnly`), so the
upgrade at 7.1 is a version bump rather than a migration.

**React Router data mode**, not framework mode: framework mode implies a server
build and takes over the Vite config, and its Vite 8/Rolldown support is
unproven. Data mode's route objects can be rendered server-side with
`createStaticHandler`, so milestone 4's edge rendering is not a framework
migration.

---

## Roadmap

1. ✅ Scaffold + foundation
2. Scheduling engine — round robin, single/double elimination, group→knockout,
   Swiss, court and time-slot allocation, standings with configurable tiebreakers
3. Tournament creation, participants, fixture generation
4. The public tournament page (edge-rendered)
5. Result entry, live standings and bracket updates
6. Court and time-slot scheduling UI
7. Freemium (free = 1 active tournament) and PDF export
