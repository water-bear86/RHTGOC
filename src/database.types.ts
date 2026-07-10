export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      leaderboard_entries: {
        Row: {
          character_id: string
          created_at: string
          damage_taken: number
          delivered: number
          grade: string
          id: string
          mission_seconds: number
          mission_slug: string
          party_size: number
          player_id: string | null
          player_name: string
          rescues: number
          score: number
          score_breakdown: Json
          season_id: string
          verification_id: string | null
          verified: boolean
        }
        Insert: Database["public"]["Tables"]["leaderboard_entries"]["Row"]
        Update: Partial<Database["public"]["Tables"]["leaderboard_entries"]["Row"]>
        Relationships: []
      }
      leaderboard_seasons: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          is_public: boolean
          name: string
          slug: string
          starts_at: string
        }
        Insert: Database["public"]["Tables"]["leaderboard_seasons"]["Row"]
        Update: Partial<Database["public"]["Tables"]["leaderboard_seasons"]["Row"]>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
