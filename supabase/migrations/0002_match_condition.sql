-- =============================================================================
-- Ronda — conditional matches
--
-- NOT YET APPLIED. Run this in the SQL Editor (or via `supabase db push`)
-- before generating any double-elimination fixture.
--
-- RE-RUNNABLE, like 0001. The Supabase SQL Editor does not wrap a script in a
-- transaction, so every statement is guarded.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- The engine emits matches that are only played in some outcomes. Today there
-- is exactly one: the double-elimination grand-final decider, which is played
-- solely when the losers-bracket entrant wins the first grand final. If the
-- winners-bracket finalist wins, they have taken the title without ever losing
-- twice and the decider must NOT be played.
--
-- The engine models this as `condition: {kind: 'ifAwayWon', matchId}` and emits
-- the match unconditionally, so the published bracket has a fixed shape rather
-- than growing a match mid-tournament. `matches` had nowhere to put that, so
-- persisting a double-elimination draw silently downgraded the decider to an
-- ordinary pending match — which would show every organiser a fixture that
-- must be played, and hand the runner-up a third defeat.
--
-- Nullable and with no default: an unconditional match stores nothing, so this
-- costs existing rows nothing and needs no backfill.
-- =============================================================================

alter table public.matches
  add column if not exists condition jsonb;

comment on column public.matches.condition is
  'Non-null when the match is only played in some outcomes. '
  '{"kind": "if_away_won", "match_id": "<uuid>"} — the decider is played only '
  'if the referenced match was won by its away side. Null for ordinary matches.';
