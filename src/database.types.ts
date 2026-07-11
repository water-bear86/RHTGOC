export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      band_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          after_state: Json | null
          band_id: string
          before_state: Json | null
          created_at: string
          id: number
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after_state?: Json | null
          band_id: string
          before_state?: Json | null
          created_at?: string
          id?: never
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after_state?: Json | null
          band_id?: string
          before_state?: Json | null
          created_at?: string
          id?: never
        }
        Relationships: []
      }
      band_contribution_events: {
        Row: {
          contribution_id: string
          id: number
          occurred_at: string
          payload: Json
          sequence: number
          status: string
        }
        Insert: {
          contribution_id: string
          id?: never
          occurred_at: string
          payload?: Json
          sequence: number
          status: string
        }
        Update: {
          contribution_id?: string
          id?: never
          occurred_at?: string
          payload?: Json
          sequence?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "band_contribution_events_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "band_contributions"
            referencedColumns: ["id"]
          },
        ]
      }
      band_contributions: {
        Row: {
          band_id: string | null
          contribution_type: string
          contributor_label: string
          contributor_player_id: string
          created_at: string
          expires_at: string
          id: string
          mission_id: string | null
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          band_id?: string | null
          contribution_type: string
          contributor_label: string
          contributor_player_id: string
          created_at: string
          expires_at: string
          id: string
          mission_id?: string | null
          resolved_at?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          band_id?: string | null
          contribution_type?: string
          contributor_label?: string
          contributor_player_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          mission_id?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "band_contributions_band_id_fkey"
            columns: ["band_id"]
            isOneToOne: false
            referencedRelation: "merry_bands"
            referencedColumns: ["id"]
          },
        ]
      }
      band_mission_history: {
        Row: {
          allocation_choice: string | null
          allocation_coin: number
          band_id: string
          completed_at: string
          id: string
          mission_id: string
          mission_slug: string
          result: Json
          seed: number
        }
        Insert: {
          allocation_choice?: string | null
          allocation_coin?: number
          band_id: string
          completed_at?: string
          id?: string
          mission_id: string
          mission_slug: string
          result: Json
          seed: number
        }
        Update: {
          allocation_choice?: string | null
          allocation_coin?: number
          band_id?: string
          completed_at?: string
          id?: string
          mission_id?: string
          mission_slug?: string
          result?: Json
          seed?: number
        }
        Relationships: [
          {
            foreignKeyName: "band_mission_history_band_id_fkey"
            columns: ["band_id"]
            isOneToOne: false
            referencedRelation: "merry_bands"
            referencedColumns: ["id"]
          },
        ]
      }
      band_progression_grants: {
        Row: {
          amount: number
          band_id: string
          grant_key: string
          granted_at: string
          id: string
          mission_id: string
          payload: Json
        }
        Insert: {
          amount: number
          band_id: string
          grant_key: string
          granted_at?: string
          id?: string
          mission_id: string
          payload?: Json
        }
        Update: {
          amount?: number
          band_id?: string
          grant_key?: string
          granted_at?: string
          id?: string
          mission_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "band_progression_grants_band_id_fkey"
            columns: ["band_id"]
            isOneToOne: false
            referencedRelation: "merry_bands"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_band_invites: {
        Row: {
          character_hint: string | null
          created_at: string
          expires_at: string
          id: string
          recipient_id: string
          responded_at: string | null
          room_code: string
          sender_id: string
          status: string
        }
        Insert: {
          character_hint?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          recipient_id: string
          responded_at?: string | null
          room_code: string
          sender_id: string
          status?: string
        }
        Update: {
          character_hint?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          recipient_id?: string
          responded_at?: string | null
          room_code?: string
          sender_id?: string
          status?: string
        }
        Relationships: []
      }
      leaderboard_entries: {
        Row: {
          band_id: string | null
          character_id: string
          clean_escape: boolean
          created_at: string
          damage_taken: number
          delivered: number
          generosity: number
          grade: string
          id: string
          mission_content_hash: string
          mission_seconds: number
          mission_slug: string
          mission_started_at: string
          mission_version: string
          party_size: number
          player_id: string | null
          player_name: string
          precision: number
          rescues: number
          score: number
          score_breakdown: Json
          season_id: string
          suspicious: boolean
          verification_id: string | null
          verified: boolean
        }
        Insert: {
          band_id?: string | null
          character_id: string
          clean_escape?: boolean
          created_at?: string
          damage_taken?: number
          delivered: number
          generosity?: number
          grade: string
          id?: string
          mission_content_hash?: string
          mission_seconds: number
          mission_slug: string
          mission_started_at: string
          mission_version?: string
          party_size: number
          player_id?: string | null
          player_name: string
          precision?: number
          rescues?: number
          score: number
          score_breakdown?: Json
          season_id: string
          suspicious?: boolean
          verification_id?: string | null
          verified?: boolean
        }
        Update: {
          band_id?: string | null
          character_id?: string
          clean_escape?: boolean
          created_at?: string
          damage_taken?: number
          delivered?: number
          generosity?: number
          grade?: string
          id?: string
          mission_content_hash?: string
          mission_seconds?: number
          mission_slug?: string
          mission_started_at?: string
          mission_version?: string
          party_size?: number
          player_id?: string | null
          player_name?: string
          precision?: number
          rescues?: number
          score?: number
          score_breakdown?: Json
          season_id?: string
          suspicious?: boolean
          verification_id?: string | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_entries_band_id_fkey"
            columns: ["band_id"]
            isOneToOne: false
            referencedRelation: "merry_bands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboard_entries_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboard_quarantine: {
        Row: {
          created_at: string
          id: string
          payload: Json
          reason: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_audit_id: string | null
          status: string
          verification_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload: Json
          reason: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_audit_id?: string | null
          status?: string
          verification_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          reason?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_audit_id?: string | null
          status?: string
          verification_id?: string
        }
        Relationships: []
      }
      leaderboard_season_snapshots: {
        Row: {
          board_slug: string
          captured_at: string
          entries: Json
          id: string
          season_id: string
        }
        Insert: {
          board_slug: string
          captured_at?: string
          entries: Json
          id?: string
          season_id: string
        }
        Update: {
          board_slug?: string
          captured_at?: string
          entries?: Json
          id?: string
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_season_snapshots_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "leaderboard_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboard_seasons: {
        Row: {
          campaign_id: string | null
          closed_at: string | null
          created_at: string
          ends_at: string
          finalize_after: string | null
          finalized_at: string | null
          id: string
          is_public: boolean
          lifecycle_state: string
          name: string
          slug: string
          starts_at: string
        }
        Insert: {
          campaign_id?: string | null
          closed_at?: string | null
          created_at?: string
          ends_at: string
          finalize_after?: string | null
          finalized_at?: string | null
          id?: string
          is_public?: boolean
          lifecycle_state?: string
          name: string
          slug: string
          starts_at: string
        }
        Update: {
          campaign_id?: string | null
          closed_at?: string | null
          created_at?: string
          ends_at?: string
          finalize_after?: string | null
          finalized_at?: string | null
          id?: string
          is_public?: boolean
          lifecycle_state?: string
          name?: string
          slug?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_seasons_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "sherwood_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      merry_band_members: {
        Row: {
          band_id: string
          hero_role: string | null
          joined_at: string
          left_at: string | null
          membership_role: string
          user_id: string
        }
        Insert: {
          band_id: string
          hero_role?: string | null
          joined_at?: string
          left_at?: string | null
          membership_role?: string
          user_id: string
        }
        Update: {
          band_id?: string
          hero_role?: string | null
          joined_at?: string
          left_at?: string | null
          membership_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "merry_band_members_band_id_fkey"
            columns: ["band_id"]
            isOneToOne: false
            referencedRelation: "merry_bands"
            referencedColumns: ["id"]
          },
        ]
      }
      merry_bands: {
        Row: {
          banner_id: string
          camp_state: Json
          created_at: string
          created_by: string
          id: string
          name: string
          progression_version: number
          updated_at: string
          village_state: Json
        }
        Insert: {
          banner_id?: string
          camp_state?: Json
          created_at?: string
          created_by: string
          id?: string
          name: string
          progression_version?: number
          updated_at?: string
          village_state?: Json
        }
        Update: {
          banner_id?: string
          camp_state?: Json
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          progression_version?: number
          updated_at?: string
          village_state?: Json
        }
        Relationships: []
      }
      player_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: []
      }
      player_friendships: {
        Row: {
          created_at: string
          requested_by: string
          responded_at: string | null
          status: string
          user_high: string
          user_low: string
        }
        Insert: {
          created_at?: string
          requested_by: string
          responded_at?: string | null
          status: string
          user_high: string
          user_low: string
        }
        Update: {
          created_at?: string
          requested_by?: string
          responded_at?: string | null
          status?: string
          user_high?: string
          user_low?: string
        }
        Relationships: []
      }
      player_social_profiles: {
        Row: {
          active_room_code: string | null
          created_at: string
          display_name: string
          friend_code: string
          last_seen_at: string
          presence_enabled: boolean
          presence_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_room_code?: string | null
          created_at?: string
          display_name: string
          friend_code: string
          last_seen_at?: string
          presence_enabled?: boolean
          presence_status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_room_code?: string | null
          created_at?: string
          display_name?: string
          friend_code?: string
          last_seen_at?: string
          presence_enabled?: boolean
          presence_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      public_hub_reports: {
        Row: {
          created_at: string
          id: number
          reason: string
          reporter_id: string
          target_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          reason: string
          reporter_id: string
          target_id: string
        }
        Update: {
          created_at?: string
          id?: never
          reason?: string
          reporter_id?: string
          target_id?: string
        }
        Relationships: []
      }
      recent_band_players: {
        Row: {
          last_played_at: string
          missions_together: number
          other_id: string
          owner_id: string
        }
        Insert: {
          last_played_at?: string
          missions_together?: number
          other_id: string
          owner_id: string
        }
        Update: {
          last_played_at?: string
          missions_together?: number
          other_id?: string
          owner_id?: string
        }
        Relationships: []
      }
      rescue_offer_events: {
        Row: {
          id: number
          occurred_at: string
          offer_id: string
          payload: Json
          sequence: number
          status: string
        }
        Insert: {
          id?: never
          occurred_at: string
          offer_id: string
          payload?: Json
          sequence: number
          status: string
        }
        Update: {
          id?: never
          occurred_at?: string
          offer_id?: string
          payload?: Json
          sequence?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rescue_offer_events_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "rescue_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      rescue_offers: {
        Row: {
          accepted_at: string | null
          attempts: number
          band_id: string | null
          context: string
          created_at: string
          expires_at: string
          id: string
          recovered_value: number
          rescue_mission_slug: string
          resolved_at: string | null
          reward_settled: boolean
          source_mission_id: string
          source_mission_slug: string
          status: string
          target_count: number
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          attempts?: number
          band_id?: string | null
          context: string
          created_at: string
          expires_at: string
          id: string
          recovered_value?: number
          rescue_mission_slug: string
          resolved_at?: string | null
          reward_settled?: boolean
          source_mission_id: string
          source_mission_slug: string
          status: string
          target_count: number
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          attempts?: number
          band_id?: string | null
          context?: string
          created_at?: string
          expires_at?: string
          id?: string
          recovered_value?: number
          rescue_mission_slug?: string
          resolved_at?: string | null
          reward_settled?: boolean
          source_mission_id?: string
          source_mission_slug?: string
          status?: string
          target_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rescue_offers_band_id_fkey"
            columns: ["band_id"]
            isOneToOne: false
            referencedRelation: "merry_bands"
            referencedColumns: ["id"]
          },
        ]
      }
      sherwood_campaign_events: {
        Row: {
          campaign_id: string
          event_id: string
          event_snapshot: Json
          event_type: string
          id: number
          occurred_at: string
          payload: Json
          sequence: number
          snapshot_revision: number
        }
        Insert: {
          campaign_id: string
          event_id: string
          event_snapshot: Json
          event_type: string
          id?: never
          occurred_at: string
          payload?: Json
          sequence: number
          snapshot_revision: number
        }
        Update: {
          campaign_id?: string
          event_id?: string
          event_snapshot?: Json
          event_type?: string
          id?: never
          occurred_at?: string
          payload?: Json
          sequence?: number
          snapshot_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "sherwood_campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "sherwood_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      sherwood_campaigns: {
        Row: {
          archived_at: string | null
          ends_at: string
          id: string
          name: string
          phase: string
          pressure: number
          revision: number
          slug: string
          starts_at: string
          state: Json
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          ends_at: string
          id: string
          name: string
          phase: string
          pressure: number
          revision: number
          slug: string
          starts_at: string
          state: Json
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          ends_at?: string
          id?: string
          name?: string
          phase?: string
          pressure?: number
          revision?: number
          slug?: string
          starts_at?: string
          state?: Json
          updated_at?: string
        }
        Relationships: []
      }
      social_mission_events: {
        Row: {
          mission_id: string
          participant_count: number
          recorded_at: string
        }
        Insert: {
          mission_id: string
          participant_count: number
          recorded_at?: string
        }
        Update: {
          mission_id?: string
          participant_count?: number
          recorded_at?: string
        }
        Relationships: []
      }
      social_rate_events: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: number
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: never
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: never
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_merry_band_member: {
        Args: {
          p_actor_user_id: string
          p_band_id: string
          p_hero_role: string
          p_member_user_id: string
        }
        Returns: Json
      }
      apply_band_mission_reward: {
        Args: {
          p_allocation_choice: string
          p_allocation_coin: number
          p_band_id: string
          p_mission_id: string
          p_mission_slug: string
          p_result: Json
          p_seed: number
        }
        Returns: boolean
      }
      block_player: { Args: { p_other_user_id: string }; Returns: boolean }
      create_merry_band: {
        Args: { p_banner_id: string; p_creator_user_id: string; p_name: string }
        Returns: string
      }
      ensure_merry_band: {
        Args: {
          p_creator_user_id: string
          p_display_name: string
          p_hero_role: string
        }
        Returns: Json
      }
      finalize_due_leaderboard_seasons: { Args: never; Returns: Json }
      get_accepted_friend_ids: {
        Args: { p_user_id: string }
        Returns: string[]
      }
      get_merry_band_state: { Args: { p_band_id: string }; Returns: Json }
      get_public_hub_blocked_ids: {
        Args: { p_user_id: string }
        Returns: string[]
      }
      load_current_sherwood_campaign: { Args: never; Returns: Json }
      read_leaderboard: {
        Args: {
          p_band_id?: string
          p_character_id?: string
          p_kind?: string
          p_mission_slug?: string
          p_party_size?: number
          p_player_ids?: string[]
          p_season_slug?: string
        }
        Returns: Json
      }
      record_band_contribution_transition: {
        Args: {
          p_band_id?: string
          p_contribution: Json
          p_occurred_at: string
          p_sequence: number
        }
        Returns: boolean
      }
      record_band_mission_outcome: {
        Args: {
          p_actor_user_id: string
          p_allocation_choice: string
          p_allocation_coin: number
          p_band_id: string
          p_mission_id: string
          p_mission_slug: string
          p_result: Json
          p_seed: number
          p_status: string
        }
        Returns: Json
      }
      record_public_hub_block: {
        Args: { p_blocked_id: string; p_blocker_id: string }
        Returns: boolean
      }
      record_public_hub_report: {
        Args: { p_reason: string; p_reporter_id: string; p_target_id: string }
        Returns: boolean
      }
      record_recent_band_players: {
        Args: { p_mission_id: string; p_user_ids: string[] }
        Returns: boolean
      }
      record_rescue_offer_transition: {
        Args: {
          p_band_id?: string
          p_occurred_at: string
          p_offer: Json
          p_sequence: number
        }
        Returns: boolean
      }
      record_sherwood_campaign_transition: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_occurred_at: string
          p_payload?: Json
          p_sequence: number
          p_snapshot: Json
        }
        Returns: boolean
      }
      record_verified_leaderboard_entry: {
        Args: {
          p_band_id: string
          p_character_id: string
          p_clean_escape: boolean
          p_damage_taken: number
          p_delivered: number
          p_generosity: number
          p_grade: string
          p_mission_seconds: number
          p_mission_slug: string
          p_mission_started_at: string
          p_party_size: number
          p_player_id: string
          p_player_name: string
          p_precision: number
          p_rescues: number
          p_score: number
          p_score_breakdown: Json
          p_season_slug: string
          p_verification_id: string
        }
        Returns: string
      }
      register_social_profile: {
        Args: { p_display_name: string }
        Returns: {
          active_room_code: string | null
          created_at: string
          display_name: string
          friend_code: string
          last_seen_at: string
          presence_enabled: boolean
          presence_status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "player_social_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_friend: { Args: { p_other_user_id: string }; Returns: boolean }
      remove_merry_band_member: {
        Args: {
          p_actor_user_id: string
          p_band_id: string
          p_member_user_id: string
        }
        Returns: Json
      }
      respond_direct_band_invite: {
        Args: { p_accept: boolean; p_invite_id: string }
        Returns: string
      }
      respond_friend_request: {
        Args: { p_accept: boolean; p_other_user_id: string }
        Returns: boolean
      }
      review_leaderboard_quarantine: {
        Args: {
          p_decision: string
          p_quarantine_id: string
          p_reviewer_id: string
        }
        Returns: Json
      }
      send_direct_band_invite: {
        Args: {
          p_character_hint?: string
          p_recipient_id: string
          p_room_code: string
        }
        Returns: string
      }
      send_friend_request: { Args: { p_friend_code: string }; Returns: boolean }
      set_merry_band_hero_role: {
        Args: { p_band_id: string; p_hero_role: string; p_user_id: string }
        Returns: Json
      }
      snapshot_leaderboard_season: {
        Args: { p_season_id: string }
        Returns: number
      }
      sync_leaderboard_season_from_campaign: {
        Args: { p_occurred_at: string; p_snapshot: Json }
        Returns: Json
      }
      update_merry_band_identity: {
        Args: {
          p_actor_user_id: string
          p_band_id: string
          p_banner_id: string
          p_name: string
        }
        Returns: Json
      }
      update_social_presence: {
        Args: { p_enabled: boolean; p_room_code?: string; p_status: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
