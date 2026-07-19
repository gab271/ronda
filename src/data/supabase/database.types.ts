/**
 * Database types.
 *
 * PLACEHOLDER — this file will be generated once the migration has been applied
 * to a real project:
 *
 *   npx supabase gen types typescript --project-id <ref> > src/data/supabase/database.types.ts
 *
 * Until then this hand-written subset keeps `createClient<Database>` typed and
 * the build green. It covers only what milestone 1 touches (profiles and clubs);
 * milestone 3 replaces the whole file with generated output.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

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
    }
    Views: Record<never, never>
    Functions: Record<never, never>
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}
