/**
 * Database types.
 *
 * DERIVED BY HAND from supabase/migrations/0001_init.sql, which is the
 * authoritative schema. This is not the CLI's output: `supabase gen types`
 * requires an access token obtained through an interactive browser login.
 *
 * Once someone has run `npx supabase login`, replace this file wholesale:
 *
 *   npx supabase gen types typescript --project-id dqaebxpfztjwqewdxuwt \
 *     > src/data/supabase/database.types.ts
 *
 * Until then: the migration and this file must be edited together. Every table,
 * enum and function below mirrors 0001_init.sql one-for-one.
 *
 * Conventions, matching what the generator would emit:
 *   - uuid and timestamptz are `string`; date is `string`; jsonb is `Json`.
 *   - Insert marks a column optional when it has a default or is nullable.
 *   - Update marks everything optional, minus generated/immutable keys.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type Sport = 'padel' | 'futbol7' | 'baloncesto' | 'ajedrez'

export type TournamentFormat =
  | 'round_robin'
  | 'single_elim'
  | 'double_elim'
  | 'groups_knockout'
  | 'swiss'

export type TournamentStatus = 'draft' | 'published' | 'in_progress' | 'finished' | 'archived'

export type ParticipantKind = 'player' | 'pair' | 'team'

export type MatchStatus = 'pending' | 'live' | 'finished' | 'walkover' | 'bye' | 'cancelled'

export type ClubRole = 'owner' | 'admin' | 'scorekeeper'

export type StageKind = 'group' | 'knockout' | 'swiss'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string | null
          locale: string
          created_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          locale?: string
          created_at?: string
        }
        Update: {
          display_name?: string | null
          locale?: string
        }
        Relationships: []
      }

      clubs: {
        Row: {
          id: string
          owner_id: string
          name: string
          slug: string
          branding: Json | null
          plan: string
          created_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          name: string
          slug: string
          branding?: Json | null
          plan?: string
          created_at?: string
        }
        Update: {
          name?: string
          slug?: string
          branding?: Json | null
          plan?: string
        }
        Relationships: []
      }

      club_members: {
        // Composite primary key (club_id, user_id) — there is no surrogate id.
        Row: {
          club_id: string
          user_id: string
          role: ClubRole
          created_at: string
        }
        Insert: {
          club_id: string
          user_id: string
          role?: ClubRole
          created_at?: string
        }
        Update: {
          role?: ClubRole
        }
        Relationships: []
      }

      tournaments: {
        Row: {
          id: string
          club_id: string
          created_by: string
          name: string
          sport: Sport
          format: TournamentFormat
          status: TournamentStatus
          public_slug: string
          timezone: string
          starts_on: string | null
          ends_on: string | null
          draw_seed: number
          config: Json
          scoring_rules: Json
          published_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          club_id: string
          created_by: string
          name: string
          sport?: Sport
          // No default in the schema: the format is always an explicit choice.
          format: TournamentFormat
          status?: TournamentStatus
          // NOT NULL with no default. The slug is minted at creation, not at
          // publish — a draft row cannot exist without one.
          public_slug: string
          timezone?: string
          starts_on?: string | null
          ends_on?: string | null
          // Defaults server-side, so reproducibility holds even if the client
          // omits it. Persisted so a disputed draw can be regenerated exactly.
          draw_seed?: number
          config?: Json
          scoring_rules?: Json
          published_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          sport?: Sport
          format?: TournamentFormat
          status?: TournamentStatus
          timezone?: string
          starts_on?: string | null
          ends_on?: string | null
          draw_seed?: number
          config?: Json
          scoring_rules?: Json
          published_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }

      courts: {
        Row: {
          id: string
          tournament_id: string
          name: string
          sort_order: number
        }
        Insert: {
          id?: string
          tournament_id: string
          name: string
          sort_order?: number
        }
        Update: {
          name?: string
          sort_order?: number
        }
        Relationships: []
      }

      participants: {
        Row: {
          id: string
          tournament_id: string
          kind: ParticipantKind
          display_name: string
          seed: number | null
          group_label: string | null
          withdrawn: boolean
          external_ref: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tournament_id: string
          kind?: ParticipantKind
          display_name: string
          seed?: number | null
          group_label?: string | null
          withdrawn?: boolean
          external_ref?: string | null
          created_at?: string
        }
        Update: {
          kind?: ParticipantKind
          display_name?: string
          seed?: number | null
          group_label?: string | null
          withdrawn?: boolean
          external_ref?: string | null
        }
        Relationships: []
      }

      participant_members: {
        // Contact details live here and are never exposed by
        // get_public_tournament(). Keep it that way.
        Row: {
          id: string
          participant_id: string
          name: string
          email: string | null
          phone: string | null
        }
        Insert: {
          id?: string
          participant_id: string
          name: string
          email?: string | null
          phone?: string | null
        }
        Update: {
          name?: string
          email?: string | null
          phone?: string | null
        }
        Relationships: []
      }

      stages: {
        Row: {
          id: string
          tournament_id: string
          kind: StageKind
          name: string
          sort_order: number
        }
        Insert: {
          id?: string
          tournament_id: string
          kind: StageKind
          name: string
          sort_order?: number
        }
        Update: {
          kind?: StageKind
          name?: string
          sort_order?: number
        }
        Relationships: []
      }

      rounds: {
        Row: {
          id: string
          stage_id: string
          idx: number
          name: string | null
        }
        Insert: {
          id?: string
          stage_id: string
          idx: number
          name?: string | null
        }
        Update: {
          idx?: number
          name?: string | null
        }
        Relationships: []
      }

      matches: {
        Row: {
          id: string
          tournament_id: string
          stage_id: string | null
          round_id: string | null
          home_participant_id: string | null
          away_participant_id: string | null
          // {"kind": "winner_of", "match_id": "...", "label": "Ganador C1"}
          home_source: Json | null
          away_source: Json | null
          // Added by 0002_match_condition.sql. Non-null only when the match is
          // played in some outcomes and not others — currently just the
          // double-elimination grand-final decider.
          condition: Json | null
          court_id: string | null
          scheduled_at: string | null
          status: MatchStatus
          // [{"h": 6, "a": 4}, {"h": 7, "a": 5}]
          score: Json | null
          home_score: number | null
          away_score: number | null
          winner_participant_id: string | null
          reported_by: string | null
          reported_at: string | null
          version: number
          created_at: string
        }
        Insert: {
          id?: string
          tournament_id: string
          stage_id?: string | null
          round_id?: string | null
          home_participant_id?: string | null
          away_participant_id?: string | null
          home_source?: Json | null
          away_source?: Json | null
          condition?: Json | null
          court_id?: string | null
          scheduled_at?: string | null
          status?: MatchStatus
          score?: Json | null
          home_score?: number | null
          away_score?: number | null
          winner_participant_id?: string | null
          reported_by?: string | null
          reported_at?: string | null
          version?: number
          created_at?: string
        }
        Update: {
          stage_id?: string | null
          round_id?: string | null
          home_participant_id?: string | null
          away_participant_id?: string | null
          home_source?: Json | null
          away_source?: Json | null
          court_id?: string | null
          scheduled_at?: string | null
          status?: MatchStatus
          score?: Json | null
          home_score?: number | null
          away_score?: number | null
          winner_participant_id?: string | null
          reported_by?: string | null
          reported_at?: string | null
          version?: number
        }
        Relationships: []
      }

      match_events: {
        // Append-only audit log. Amateur sport has arguments about who entered
        // what — there is deliberately no update or delete path.
        Row: {
          id: string
          match_id: string
          actor_id: string | null
          kind: string
          payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          match_id: string
          actor_id?: string | null
          kind: string
          payload?: Json
          created_at?: string
        }
        Update: never
        Relationships: []
      }
    }

    Views: Record<never, never>

    Functions: {
      /**
       * The entire anonymous surface of the database. SECURITY DEFINER and
       * shape-controlled, so participant emails and phones cannot leak.
       * Returns null when the slug is unknown or the tournament is still a draft.
       */
      get_public_tournament: {
        Args: { p_slug: string }
        Returns: Json
      }
      /**
       * The only write path for scores. p_token is unused until milestone 5 adds
       * match_tokens; it is in the signature now so delegated scorekeeping never
       * becomes a second implementation of the scoring rules.
       */
      report_score: {
        Args: { p_match_id: string; p_score: Json; p_token?: string }
        Returns: Database['public']['Tables']['matches']['Row']
      }
      /** SECURITY DEFINER helper that exists to break RLS recursion. */
      is_club_member: {
        Args: { p_club_id: string; p_min_role?: ClubRole }
        Returns: boolean
      }
    }

    Enums: {
      sport: Sport
      tournament_format: TournamentFormat
      tournament_status: TournamentStatus
      participant_kind: ParticipantKind
      match_status: MatchStatus
      club_role: ClubRole
      stage_kind: StageKind
    }

    CompositeTypes: Record<never, never>
  }
}
