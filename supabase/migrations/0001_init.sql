-- =============================================================================
-- Cuadro — initial schema
--
-- RE-RUNNABLE. Every statement is idempotent, so applying this twice is safe and
-- a partially-applied run can simply be re-run. That matters because the
-- Supabase SQL Editor does not wrap a script in a transaction: if any statement
-- fails, everything before it stays committed, and a naive re-run then dies on
-- "relation already exists" without telling you how far it got.
--
-- Security posture, stated once because every policy below follows from it:
--
--   * Every table has RLS enabled and no permissive default.
--   * ANONYMOUS READS NEVER TOUCH TABLES. The public tournament page calls one
--     SECURITY DEFINER function, get_public_tournament(), which shapes its own
--     output. See the comment above it for the five reasons.
--   * Organiser writes key on club membership via is_club_member(), a SECURITY
--     DEFINER helper that exists to break RLS recursion.
--   * All score writes go through report_score() from the first implementation,
--     so delegated scorekeeping has one audited path rather than two.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- ENUMS
--
-- Guarded individually: CREATE TYPE has no IF NOT EXISTS, and the alternative
-- (DROP TYPE ... CASCADE) would silently drop every column using the type.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'sport') then
    create type public.sport as enum ('padel', 'futbol7', 'baloncesto', 'ajedrez');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'tournament_format') then
    create type public.tournament_format as enum
      ('round_robin', 'single_elim', 'double_elim', 'groups_knockout', 'swiss');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'tournament_status') then
    create type public.tournament_status as enum
      ('draft', 'published', 'in_progress', 'finished', 'archived');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'participant_kind') then
    create type public.participant_kind as enum ('player', 'pair', 'team');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'match_status') then
    create type public.match_status as enum
      ('pending', 'live', 'finished', 'walkover', 'bye', 'cancelled');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'club_role') then
    create type public.club_role as enum ('owner', 'admin', 'scorekeeper');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'stage_kind') then
    create type public.stage_kind as enum ('group', 'knockout', 'swiss');
  end if;
end
$$;

-- =============================================================================
-- TABLES
-- =============================================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text,
  locale       text not null default 'es',
  created_at   timestamptz not null default now()
);

create table if not exists public.clubs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles on delete cascade,
  name       text not null,
  slug       text not null unique,
  -- Per-club branding is a paid feature (milestone 7), applied client-side by
  -- overriding --color-brand. See src/styles/tokens/semantic.css.
  branding   jsonb,
  plan       text not null default 'free',
  created_at timestamptz not null default now()
);

-- Separate membership table so a club can have several organisers and delegated
-- scorekeepers without a nullable-FK migration later.
create table if not exists public.club_members (
  club_id    uuid not null references public.clubs on delete cascade,
  user_id    uuid not null references public.profiles on delete cascade,
  role       public.club_role not null default 'admin',
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

create table if not exists public.tournaments (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs on delete cascade,
  created_by  uuid not null references public.profiles,
  name        text not null,
  sport       public.sport not null default 'padel',
  format      public.tournament_format not null,
  status      public.tournament_status not null default 'draft',

  -- Opaque nanoid-style slug, NOT derived from the name:
  --   * name slugs collide between clubs,
  --   * they break when an organiser fixes a typo,
  --   * they make unpublished drafts enumerable (/t/torneo-verano-2026).
  -- Ambiguous characters (0/O, 1/l/I) are excluded when generating, because
  -- people read these aloud at clubs and type them by hand.
  public_slug text not null unique,

  timezone    text not null default 'Europe/Madrid',
  starts_on   date,
  ends_on     date,

  -- Reproducible draws: the engine PRNG is seeded from this, so regenerating a
  -- bracket gives the identical result and a disputed draw can be audited.
  draw_seed   integer not null default (floor(random() * 2147483647))::integer,

  config        jsonb not null default '{}'::jsonb,
  scoring_rules jsonb not null default '{}'::jsonb,

  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.courts (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  name          text not null,
  sort_order    integer not null default 0
);

-- ONE polymorphic participants table, not players/pairs/teams. A padel pair, a
-- football squad and a chess single are the same thing to the scheduling
-- engine: an entity occupying a slot. Three tables would mean three sets of RLS
-- policies, three engine types and three of every query, forever.
create table if not exists public.participants (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  kind          public.participant_kind not null default 'pair',
  display_name  text not null,
  seed          integer,
  group_label   text,
  withdrawn     boolean not null default false,
  external_ref  text,
  created_at    timestamptz not null default now()
);

-- Contact details live HERE and are never exposed by get_public_tournament().
-- That separation is the reason anonymous reads go through a shaped function
-- rather than table policies.
create table if not exists public.participant_members (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants on delete cascade,
  name           text not null,
  email          text,
  phone          text
);

create table if not exists public.stages (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  kind          public.stage_kind not null,
  name          text not null,
  sort_order    integer not null default 0
);

create table if not exists public.rounds (
  id       uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages on delete cascade,
  idx      integer not null,
  name     text
);

create table if not exists public.matches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  stage_id      uuid references public.stages on delete cascade,
  round_id      uuid references public.rounds on delete cascade,

  home_participant_id uuid references public.participants on delete set null,
  away_participant_id uuid references public.participants on delete set null,

  -- For bracket matches whose participants are not yet decided:
  -- {"kind": "winner_of", "match_id": "...", "label": "Ganador C1"}
  home_source jsonb,
  away_source jsonb,

  court_id     uuid references public.courts on delete set null,
  scheduled_at timestamptz,
  status       public.match_status not null default 'pending',

  -- NOTE: there is deliberately no separate `results` table. A match has exactly
  -- one result, so a 1:1 join would sit on the hottest read path for no benefit.
  -- The instinct behind wanting one — score disputes — is served by match_events
  -- below, an append-only audit log rather than a mirror of this row.
  score jsonb,                        -- [{"h": 6, "a": 4}, {"h": 7, "a": 5}]
  home_score integer,
  away_score integer,
  winner_participant_id uuid references public.participants on delete set null,

  reported_by uuid references public.profiles,
  reported_at timestamptz,
  version     integer not null default 0,

  created_at timestamptz not null default now()
);

create table if not exists public.match_events (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches on delete cascade,
  actor_id   uuid references public.profiles,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Indexes are named explicitly so IF NOT EXISTS works — the auto-generated
-- names that `create index on ...` produces cannot be guarded.
create index if not exists tournaments_club_id_idx        on public.tournaments (club_id);
create index if not exists tournaments_public_slug_idx    on public.tournaments (public_slug) where status <> 'draft';
create index if not exists participants_tournament_id_idx on public.participants (tournament_id);
create index if not exists participant_members_pid_idx    on public.participant_members (participant_id);
create index if not exists matches_tournament_id_idx      on public.matches (tournament_id);
create index if not exists matches_round_id_idx           on public.matches (round_id);
create index if not exists courts_tournament_id_idx       on public.courts (tournament_id);
create index if not exists stages_tournament_id_idx       on public.stages (tournament_id);
create index if not exists rounds_stage_id_idx            on public.rounds (stage_id);
create index if not exists club_members_user_id_idx       on public.club_members (user_id);
create index if not exists match_events_match_id_idx      on public.match_events (match_id);

-- =============================================================================
-- HELPERS
-- =============================================================================

-- RECURSION FOOTGUN, DEFUSED.
-- A policy on club_members that itself selects from club_members recurses
-- infinitely and errors at query time. Because this is SECURITY DEFINER it
-- bypasses RLS on the lookup, so it is safe to use in every policy INCLUDING
-- club_members' own.
create or replace function public.is_club_member(
  p_club_id  uuid,
  p_min_role public.club_role default 'scorekeeper'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_members m
    where m.club_id = p_club_id
      and m.user_id = (select auth.uid())
      and case p_min_role
            when 'scorekeeper' then true
            when 'admin'       then m.role in ('owner', 'admin')
            when 'owner'       then m.role = 'owner'
          end
  );
$$;

-- Every new user gets a profile and a personal club, so tournaments.club_id is
-- never null. Multi-organiser clubs and paid per-club branding then need no
-- schema change later.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id uuid;
  v_slug    text;
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  v_slug := 'club-' || substr(replace(new.id::text, '-', ''), 1, 10);

  insert into public.clubs (owner_id, name, slug)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'club_name', 'Mi club'), v_slug)
  on conflict (slug) do nothing
  returning id into v_club_id;

  if v_club_id is not null then
    insert into public.club_members (club_id, user_id, role)
    values (v_club_id, new.id, 'owner')
    on conflict (club_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.clubs               enable row level security;
alter table public.club_members        enable row level security;
alter table public.tournaments         enable row level security;
alter table public.courts              enable row level security;
alter table public.participants        enable row level security;
alter table public.participant_members enable row level security;
alter table public.stages              enable row level security;
alter table public.rounds              enable row level security;
alter table public.matches             enable row level security;
alter table public.match_events        enable row level security;

revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete on
  public.clubs, public.tournaments, public.courts, public.participants,
  public.participant_members, public.stages, public.rounds, public.matches,
  public.club_members
  to authenticated;

grant select, update on public.profiles to authenticated;
grant select on public.match_events to authenticated;

-- anon receives NO table grants at all. Its only access to anything in this
-- database is EXECUTE on get_public_tournament().

-- Policies are dropped first so this section is re-runnable.
drop policy if exists "own profile readable"              on public.profiles;
drop policy if exists "own profile updatable"             on public.profiles;
drop policy if exists "member clubs readable"             on public.clubs;
drop policy if exists "own club updatable"                on public.clubs;
drop policy if exists "clubs insertable by owner"         on public.clubs;
drop policy if exists "membership readable by members"    on public.club_members;
drop policy if exists "membership managed by admins"      on public.club_members;
drop policy if exists "club tournaments readable"         on public.tournaments;
drop policy if exists "club tournaments writable"         on public.tournaments;
drop policy if exists "courts follow tournament"          on public.courts;
drop policy if exists "participants follow tournament"    on public.participants;
drop policy if exists "participant members follow participant" on public.participant_members;
drop policy if exists "stages follow tournament"          on public.stages;
drop policy if exists "rounds follow stage"               on public.rounds;
drop policy if exists "matches readable by members"       on public.matches;
drop policy if exists "matches writable by admins"        on public.matches;
drop policy if exists "match events readable by members"  on public.match_events;

-- auth.uid() is wrapped in a subselect throughout. Postgres then evaluates it
-- once per statement instead of once per row — Supabase measures 90%+ faster on
-- larger scans, and it is their documented recommendation.
create policy "own profile readable" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "own profile updatable" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "member clubs readable" on public.clubs
  for select to authenticated
  using (public.is_club_member(id));

create policy "own club updatable" on public.clubs
  for update to authenticated
  using (public.is_club_member(id, 'admin'))
  with check (public.is_club_member(id, 'admin'));

create policy "clubs insertable by owner" on public.clubs
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "membership readable by members" on public.club_members
  for select to authenticated
  using (public.is_club_member(club_id));

create policy "membership managed by admins" on public.club_members
  for all to authenticated
  using (public.is_club_member(club_id, 'admin'))
  with check (public.is_club_member(club_id, 'admin'));

create policy "club tournaments readable" on public.tournaments
  for select to authenticated
  using (public.is_club_member(club_id));

create policy "club tournaments writable" on public.tournaments
  for all to authenticated
  using (public.is_club_member(club_id, 'admin'))
  with check (public.is_club_member(club_id, 'admin'));

create policy "courts follow tournament" on public.courts
  for all to authenticated
  using (exists (select 1 from public.tournaments t
                 where t.id = tournament_id and public.is_club_member(t.club_id, 'admin')))
  with check (exists (select 1 from public.tournaments t
                      where t.id = tournament_id and public.is_club_member(t.club_id, 'admin')));

create policy "participants follow tournament" on public.participants
  for all to authenticated
  using (exists (select 1 from public.tournaments t
                 where t.id = tournament_id and public.is_club_member(t.club_id, 'admin')))
  with check (exists (select 1 from public.tournaments t
                      where t.id = tournament_id and public.is_club_member(t.club_id, 'admin')));

create policy "participant members follow participant" on public.participant_members
  for all to authenticated
  using (exists (select 1 from public.participants p
                 join public.tournaments t on t.id = p.tournament_id
                 where p.id = participant_id and public.is_club_member(t.club_id, 'admin')))
  with check (exists (select 1 from public.participants p
                      join public.tournaments t on t.id = p.tournament_id
                      where p.id = participant_id and public.is_club_member(t.club_id, 'admin')));

create policy "stages follow tournament" on public.stages
  for all to authenticated
  using (exists (select 1 from public.tournaments t
                 where t.id = tournament_id and public.is_club_member(t.club_id, 'admin')))
  with check (exists (select 1 from public.tournaments t
                      where t.id = tournament_id and public.is_club_member(t.club_id, 'admin')));

create policy "rounds follow stage" on public.rounds
  for all to authenticated
  using (exists (select 1 from public.stages s
                 join public.tournaments t on t.id = s.tournament_id
                 where s.id = stage_id and public.is_club_member(t.club_id, 'admin')))
  with check (exists (select 1 from public.stages s
                      join public.tournaments t on t.id = s.tournament_id
                      where s.id = stage_id and public.is_club_member(t.club_id, 'admin')));

-- Matches are readable by any club member but writable only by admins.
-- Scorekeepers do not write here directly; they go through report_score().
create policy "matches readable by members" on public.matches
  for select to authenticated
  using (exists (select 1 from public.tournaments t
                 where t.id = tournament_id and public.is_club_member(t.club_id)));

create policy "matches writable by admins" on public.matches
  for all to authenticated
  using (exists (select 1 from public.tournaments t
                 where t.id = tournament_id and public.is_club_member(t.club_id, 'admin')))
  with check (exists (select 1 from public.tournaments t
                      where t.id = tournament_id and public.is_club_member(t.club_id, 'admin')));

create policy "match events readable by members" on public.match_events
  for select to authenticated
  using (exists (select 1 from public.matches m
                 join public.tournaments t on t.id = m.tournament_id
                 where m.id = match_id and public.is_club_member(t.club_id)));

-- =============================================================================
-- THE PUBLIC READ
--
-- One SECURITY DEFINER function, granted to anon, is the ENTIRE anonymous
-- surface of this database. Five reasons this beats anon SELECT policies:
--
--   1. One round trip instead of four. The public page needs tournament +
--      participants + matches + courts; as table reads on a 300ms-RTT link that
--      is over a second of dead time.
--   2. Column-level control. Participant emails and phone numbers physically
--      cannot leak — they are not in the document and cannot be requested. With
--      table policies we would be one `select *` from publishing them.
--   3. No anon policies to get subtly wrong across nine tables.
--   4. Drafts are not enumerable: unknown slug and unpublished slug both NULL.
--   5. One cacheable URL, which is exactly what milestone 4's edge function
--      will cache.
--
-- search_path is pinned to '' and every reference schema-qualified: without
-- that, a SECURITY DEFINER function can be hijacked via a mutable search_path.
-- =============================================================================

create or replace function public.get_public_tournament(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',          t.id,
    'name',        t.name,
    'sport',       t.sport,
    'format',      t.format,
    'status',      t.status,
    'publicSlug',  t.public_slug,
    'timezone',    t.timezone,
    'startsOn',    t.starts_on,
    'endsOn',      t.ends_on,
    'clubName',    c.name,
    'branding',    c.branding,

    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',          p.id,
        'displayName', p.display_name,
        'seed',        p.seed,
        'groupId',     p.group_label,
        'withdrawn',   p.withdrawn
      ) order by p.seed nulls last, p.display_name)
      from public.participants p
      where p.tournament_id = t.id
    ), '[]'::jsonb),

    'courts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',        ct.id,
        'name',      ct.name,
        'sortOrder', ct.sort_order
      ) order by ct.sort_order)
      from public.courts ct
      where ct.tournament_id = t.id
    ), '[]'::jsonb),

    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                  m.id,
        'roundId',             m.round_id,
        'stageId',             m.stage_id,
        'homeParticipantId',   m.home_participant_id,
        'awayParticipantId',   m.away_participant_id,
        'homeLabel',           m.home_source ->> 'label',
        'awayLabel',           m.away_source ->> 'label',
        'courtId',             m.court_id,
        'scheduledAt',         m.scheduled_at,
        'status',              m.status,
        'score',               m.score,
        'winnerParticipantId', m.winner_participant_id
      ) order by m.scheduled_at nulls last, m.created_at)
      from public.matches m
      where m.tournament_id = t.id
    ), '[]'::jsonb)
  )
  from public.tournaments t
  join public.clubs c on c.id = t.club_id
  where t.public_slug = p_slug
    and t.status in ('published', 'in_progress', 'finished');
$$;

revoke all on function public.get_public_tournament(text) from public;
grant execute on function public.get_public_tournament(text) to anon, authenticated;

-- =============================================================================
-- SCORE ENTRY — one path, from the first implementation.
--
-- Today this authorises via club membership. What organisers will actually ask
-- for is a link letting whoever is standing at court 3 enter a score without
-- signing up; milestone 5 adds that as a match_tokens table checked via p_token.
-- The argument is in the signature NOW so both auth modes flow through one
-- audited function. A second write path later would mean two implementations of
-- the scoring rules, which is how a tournament ends up with two standings.
-- =============================================================================

create or replace function public.report_score(
  p_match_id uuid,
  p_score    jsonb,
  p_token    text default null
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_club  uuid;
begin
  -- NOTE: club_id is fetched on its own rather than as `select m.*, t.club_id
  -- into v_match, v_club`. With multiple INTO targets PL/pgSQL assigns ONE
  -- COLUMN PER TARGET, so that form would put m.id into a matches-rowtype
  -- variable and fail at runtime — and only when the function is called, never
  -- when it is created.
  select t.club_id
    into v_club
  from public.matches m
  join public.tournaments t on t.id = m.tournament_id
  where m.id = p_match_id;

  if not found then
    raise exception 'Match not found' using errcode = 'no_data_found';
  end if;

  if not public.is_club_member(v_club, 'scorekeeper') then
    raise exception 'Not authorised to report this score'
      using errcode = 'insufficient_privilege';
  end if;

  update public.matches
  set score       = p_score,
      status      = 'finished',
      reported_by = (select auth.uid()),
      reported_at = now(),
      version     = version + 1
  where id = p_match_id
  returning * into v_match;

  insert into public.match_events (match_id, actor_id, kind, payload)
  values (p_match_id, (select auth.uid()), 'score_reported', p_score);

  return v_match;
end;
$$;

revoke all on function public.report_score(uuid, jsonb, text) from public;
grant execute on function public.report_score(uuid, jsonb, text) to authenticated;
