-- =============================================================================
-- ⚠️  DESTRUCTIVE — DEVELOPMENT ONLY  ⚠️
--
-- Drops every Cuadro object so 0001_init.sql can be applied to a clean slate.
-- THIS DELETES ALL TOURNAMENT DATA. Never run it against a database that has
-- real clubs or tournaments in it.
--
-- You probably do NOT need this. 0001_init.sql is idempotent — re-running it
-- over a partially-applied database fills in whatever is missing and leaves
-- existing data alone. Use this only if you want to start over.
--
-- Note: this deliberately does NOT touch auth.users. Dropping your account would
-- mean re-registering, and the profiles/clubs rows are recreated by the
-- on_auth_user_created trigger only on INSERT — an existing user would end up
-- with no profile and no club. If you want to clear users too, do it from
-- Authentication → Users in the dashboard, AFTER running this.
-- =============================================================================

-- Trigger first: it references handle_new_user().
drop trigger if exists on_auth_user_created on auth.users;

drop function if exists public.report_score(uuid, jsonb, text);
drop function if exists public.get_public_tournament(text);
drop function if exists public.handle_new_user();
drop function if exists public.is_club_member(uuid, public.club_role);

-- Tables in dependency order. CASCADE also removes their policies and indexes.
drop table if exists public.match_events cascade;
drop table if exists public.matches cascade;
drop table if exists public.rounds cascade;
drop table if exists public.stages cascade;
drop table if exists public.participant_members cascade;
drop table if exists public.participants cascade;
drop table if exists public.courts cascade;
drop table if exists public.tournaments cascade;
drop table if exists public.club_members cascade;
drop table if exists public.clubs cascade;
drop table if exists public.profiles cascade;

-- Enums last: the tables using them must be gone first.
drop type if exists public.stage_kind;
drop type if exists public.club_role;
drop type if exists public.match_status;
drop type if exists public.participant_kind;
drop type if exists public.tournament_status;
drop type if exists public.tournament_format;
drop type if exists public.sport;
