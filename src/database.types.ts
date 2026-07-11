export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      band_audit_log: {
        Row: { action: string; actor_user_id: string | null; after_state: Json | null; band_id: string; before_state: Json | null; created_at: string; id: number }
        Insert: { action: string; actor_user_id?: string | null; after_state?: Json | null; band_id: string; before_state?: Json | null; created_at?: string; id?: never }
        Update: Partial<Database["public"]["Tables"]["band_audit_log"]["Insert"]>
        Relationships: []
      }
      band_mission_history: {
        Row: { allocation_choice: string | null; allocation_coin: number; band_id: string; completed_at: string; id: string; mission_id: string; mission_slug: string; result: Json; seed: number }
        Insert: { allocation_choice?: string | null; allocation_coin?: number; band_id: string; completed_at?: string; id?: string; mission_id: string; mission_slug: string; result: Json; seed: number }
        Update: Partial<Database["public"]["Tables"]["band_mission_history"]["Insert"]>
        Relationships: []
      }
      band_progression_grants: {
        Row: { amount: number; band_id: string; grant_key: string; granted_at: string; id: string; mission_id: string; payload: Json }
        Insert: { amount: number; band_id: string; grant_key: string; granted_at?: string; id?: string; mission_id: string; payload?: Json }
        Update: Partial<Database["public"]["Tables"]["band_progression_grants"]["Insert"]>
        Relationships: []
      }
      leaderboard_entries: {
        Row: {
          character_id: string
          band_id: string | null
          clean_escape: boolean
          created_at: string
          damage_taken: number
          delivered: number
          generosity: number
          grade: string
          id: string
          mission_seconds: number
          mission_slug: string
          party_size: number
          precision: number
          player_id: string | null
          player_name: string
          rescues: number
          score: number
          score_breakdown: Json
          season_id: string
          verification_id: string | null
          verified: boolean
          suspicious: boolean
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
      merry_band_members: {
        Row: { band_id: string; hero_role: string | null; joined_at: string; left_at: string | null; membership_role: string; user_id: string }
        Insert: { band_id: string; hero_role?: string | null; joined_at?: string; left_at?: string | null; membership_role?: string; user_id: string }
        Update: Partial<Database["public"]["Tables"]["merry_band_members"]["Insert"]>
        Relationships: []
      }
      merry_bands: {
        Row: { banner_id: string; camp_state: Json; created_at: string; created_by: string; id: string; name: string; progression_version: number; updated_at: string; village_state: Json }
        Insert: { banner_id?: string; camp_state?: Json; created_at?: string; created_by: string; id?: string; name: string; progression_version?: number; updated_at?: string; village_state?: Json }
        Update: Partial<Database["public"]["Tables"]["merry_bands"]["Insert"]>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      apply_band_mission_reward: {
        Args: { p_allocation_choice: string; p_allocation_coin: number; p_band_id: string; p_mission_id: string; p_mission_slug: string; p_result: Json; p_seed: number }
        Returns: boolean
      }
      create_merry_band: {
        Args: { p_banner_id: string; p_creator_user_id: string; p_name: string }
        Returns: string
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
