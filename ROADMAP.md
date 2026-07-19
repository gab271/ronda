# Roadmap

Read `CLAUDE.md` first for constraints, stack traps and enforced boundaries.

Work in milestones and **pause for approval after each one**. After every
milestone run `npm run verify` and report what actually ran.

---

## Done

### ✅ Milestone 1 — Scaffold + foundation

Vite/React/TS, split tsconfigs, ESLint + stylelint boundary rules, Vitest with
three projects (`engine` / `app` / `ssr`), the Pista token system, i18n (es
inline, en lazy, typed keys), Supabase client + the separate public fetch client,
`AuthProvider`, sign-in, `requireSession` loader guard, organiser shell,
`0001_init.sql` with full RLS, Cloudflare Pages config, secret-scan build guard.

### ✅ Milestone 2 — Scheduling engine

`src/engine/`, pure and framework-free, 341 tests:

| Module | What it does |
| --- | --- |
| `rng.ts` | Seeded mulberry32 + Fisher-Yates. Draws are reproducible from `draw_seed`. |
| `roundRobin.ts` | Circle method, byes for odd fields, 1 or 2 legs, home/away balance |
| `seeding.ts` | Standard bracket order (1v8, 4v5, 2v7, 3v6), round labels |
| `singleElimination.ts` | Seeding, byes to top seeds, third place. `buildKnockoutBracket` is reused by the group stage. |
| `doubleElimination.ts` | Winners/losers brackets, reversed drop-ins to delay rematches, conditional grand-final reset |
| `groups.ts` | Serpentine group assignment, group→knockout with same-group avoidance |
| `swiss.ts` | Backtracking pairing that never repeats an opponent; reports honestly when impossible |
| `standings.ts` | Configurable tiebreakers. Head-to-head is a mini-league among the tied set only; every other criterion uses the full table. |
| `allocation.ts` | Courts × time slots, no double-booking, precedence, minimum rest, waiting-time minimisation |
| `resolve.ts` | Slot resolution, bye propagation, topological ordering, bracket simulation |

### ✅ Landing page (out of original order)

`src/routes/landing/`. Court-blue hero with a bracket that fills itself in.
Imports no auth code and no supabase-js. Payload ~119 kB gz.

---

## Remaining

### ⬜ Milestone 3 — Tournament creation

The first real organiser workflow. Everything behind auth.

- Create a tournament: name, sport, format, dates, timezone (**must support
  `Atlantic/Canary`**, not just `Europe/Madrid` — an hour's difference produces
  wrong match times for real users).
- Add participants: pairs, teams or individuals. Paste-a-list bulk entry, since
  that is how organisers actually have their data. Seeds optional.
- Generate fixtures by calling `src/engine/` and persisting the result.
  Persist `draw_seed` so the draw can be regenerated identically.
- Regenerate must warn if results already exist — regenerating orphans them.
- Publish: `draft` → `published`, mint the `public_slug`.
- Slug generation: **nanoid(10) excluding ambiguous characters** (`0/O`, `1/l/I`)
  — people read these aloud at clubs.

Also here: **generate the real `database.types.ts`**. The committed file is a
hand-written placeholder covering only `profiles` and `clubs`.

```bash
npx supabase gen types typescript --project-id <ref> > src/data/supabase/database.types.ts
```

### ⬜ Milestone 4 — The public tournament page

The storefront. Make this genuinely excellent; it is what sells the product.

- `/t/:slug` — bracket, standings, schedule, "your next match".
- Reuse the landing page's bracket rendering; it was built to be reused.
- **Edge-render via Cloudflare Pages Functions.** The seams are already in
  place: `publicClient.ts` runs unmodified in a Worker, and `publicLoader.ts`
  reads `window.__CUADRO_DATA__` if present, so the client diff is zero lines.
  Add `HydrateFallback` — React Router warns without one.
- **Poll every 25–30s, gated on `document.visibilityState`. No realtime.** The
  free tier caps at 200 concurrent connections and WebSockets reconnect-storm on
  outdoor 4G.
- Empty, loading and error states in the product's voice, already drafted in
  `es/public.json`.

Consider **prerendering the landing page** here too — it is fully static, unlike
tournaments, so it can be built to HTML for instant paint and real SEO.

### ⬜ Milestone 5 — Result entry + live updates

- Score entry for the organiser. **All writes go through the existing
  `report_score()` RPC** — never direct table writes, or scoring rules end up
  with two implementations and a tournament gets two different standings.
- Winners advance automatically via `resolveSlot`/`propagateByes`.
- Standings recompute from results on every read. **Never store standings.**
- Add `match_tokens` (token, tournament_id, scope, expires_at) so a scorekeeper
  at court 3 can enter a score with no account. `report_score()` already accepts
  `p_token` for exactly this — validate it there.
- Wire the `match_events` append-only audit log. Amateur sport has arguments
  about who entered what.

### ⬜ Milestone 6 — Court and time-slot scheduling UI

- Configure courts and match duration; call `allocateCourts()`.
- Show the cost of a configuration **before** the organiser commits:
  `minimumSlots()` and `computeWaitMinutes()` exist for this.
- Manual drag-to-reschedule, validated with `findScheduleConflicts()`.
- Render as a court × time grid.

### ⬜ Milestone 7 — Freemium + PDF export

- Free = 1 active tournament. Paid = unlimited + club branding.
- **Branding is already a solved problem**: read `clubs.branding` jsonb and
  inject one `<style>` overriding `--color-brand` on `:root`. Zero component
  changes — that is the whole reason for the token discipline.
- PDF export of bracket and final standings, for printing and pinning on the
  club noticeboard. Must be client-side (no server, no cost).
- Payments: Stripe. **The `sk_live` key must never get a `VITE_` prefix** — the
  build guard checks for it.

---

## Loose ends, any milestone

- **Landing page links to routes that do not exist**: `/registro`, `/contacto`,
  `/terminos`, and `/t/ejemplo`. All currently hit `NotFoundRoute`. `/registro`
  is the most urgent — it is the primary CTA.
- **Archivo font is not installed.** `public/fonts/archivo-variable-latin.woff2`
  is missing, so everything falls back to `system-ui`. See README for the
  subsetting command. The design assumes the width axis and tabular figures.
- **Sign-up flow does not exist.** Only sign-in is built.
- **Supabase pauses after ~7 days idle.** A dead tournament link is the worst
  possible storefront failure and it is invisible in development. Add a free
  Cloudflare Cron Trigger before any real use.
- **Built-in SMTP is ~2–4 emails/hour** and not for production. Configure Resend
  or Brevo before inviting anyone.
- **`report_score()` has never been executed.** Its PL/pgSQL was fixed by
  reasoning, and static parsing does not catch `INTO` arity bugs. Exercise it
  properly in milestone 5.
- Decide the name (see `CLAUDE.md`). Cheapest now.
