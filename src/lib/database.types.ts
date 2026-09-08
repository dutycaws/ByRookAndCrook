export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      beverages: {
        Row: {
          brew_session_id: string
          created_at: string
          id: string
          ingredient_batch_id: string
          name: string
          quality_index: number
          rules_version: string
          save_id: string
        }
        Insert: {
          brew_session_id: string
          created_at?: string
          id?: string
          ingredient_batch_id: string
          name: string
          quality_index: number
          rules_version: string
          save_id: string
        }
        Update: {
          brew_session_id?: string
          created_at?: string
          id?: string
          ingredient_batch_id?: string
          name?: string
          quality_index?: number
          rules_version?: string
          save_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beverages_save_id_brew_session_id_fkey"
            columns: ["save_id", "brew_session_id"]
            isOneToOne: true
            referencedRelation: "brew_sessions"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "beverages_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beverages_save_id_ingredient_batch_id_fkey"
            columns: ["save_id", "ingredient_batch_id"]
            isOneToOne: false
            referencedRelation: "ingredient_batches"
            referencedColumns: ["save_id", "id"]
          },
        ]
      }
      brew_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          day_number: number
          duration_seconds: number
          good_ticks: number | null
          id: string
          ingredient_batch_id: string
          ingredient_brew_bonus: number
          ingredient_quality_index: number
          perfect_ticks: number | null
          quality_index: number | null
          rules_version: string
          save_id: string
          started_at: string
          status: string
          stir_score: number | null
          total_ticks: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          day_number: number
          duration_seconds?: number
          good_ticks?: number | null
          id?: string
          ingredient_batch_id: string
          ingredient_brew_bonus: number
          ingredient_quality_index: number
          perfect_ticks?: number | null
          quality_index?: number | null
          rules_version: string
          save_id: string
          started_at?: string
          status?: string
          stir_score?: number | null
          total_ticks?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          day_number?: number
          duration_seconds?: number
          good_ticks?: number | null
          id?: string
          ingredient_batch_id?: string
          ingredient_brew_bonus?: number
          ingredient_quality_index?: number
          perfect_ticks?: number | null
          quality_index?: number | null
          rules_version?: string
          save_id?: string
          started_at?: string
          status?: string
          stir_score?: number | null
          total_ticks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "brew_sessions_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brew_sessions_save_id_ingredient_batch_id_fkey"
            columns: ["save_id", "ingredient_batch_id"]
            isOneToOne: false
            referencedRelation: "ingredient_batches"
            referencedColumns: ["save_id", "id"]
          },
        ]
      }
      craft_actions: {
        Row: {
          action_id: string
          actor_id: string
          command_kind: string
          committed_revision: number
          created_at: string
          input_expected_revision: number
          input_good_ticks: number | null
          input_perfect_ticks: number | null
          input_total_ticks: number | null
          result: Json
          save_id: string
          subject_id: string | null
        }
        Insert: {
          action_id: string
          actor_id: string
          command_kind: string
          committed_revision: number
          created_at?: string
          input_expected_revision: number
          input_good_ticks?: number | null
          input_perfect_ticks?: number | null
          input_total_ticks?: number | null
          result: Json
          save_id: string
          subject_id?: string | null
        }
        Update: {
          action_id?: string
          actor_id?: string
          command_kind?: string
          committed_revision?: number
          created_at?: string
          input_expected_revision?: number
          input_good_ticks?: number | null
          input_perfect_ticks?: number | null
          input_total_ticks?: number | null
          result?: Json
          save_id?: string
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "craft_actions_save_id_actor_id_fkey"
            columns: ["save_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "craft_actions_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      dialogue_turns: {
        Row: {
          actor_id: string
          beverage_id: string | null
          calls: number
          card_id: string | null
          checkpoints: Json
          completed_at: string | null
          content_version: string
          created_at: string
          day: number
          error_code: string | null
          fence: string
          id: string
          input_sequence: number
          lease_until: string
          message: string
          patron_key: string
          result: Json | null
          rule_version: string
          save_id: string
          source_revision: number
          status: string
        }
        Insert: {
          actor_id: string
          beverage_id?: string | null
          calls?: number
          card_id?: string | null
          checkpoints?: Json
          completed_at?: string | null
          content_version?: string
          created_at?: string
          day: number
          error_code?: string | null
          fence?: string
          id: string
          input_sequence: number
          lease_until: string
          message: string
          patron_key: string
          result?: Json | null
          rule_version?: string
          save_id: string
          source_revision: number
          status: string
        }
        Update: {
          actor_id?: string
          beverage_id?: string | null
          calls?: number
          card_id?: string | null
          checkpoints?: Json
          completed_at?: string | null
          content_version?: string
          created_at?: string
          day?: number
          error_code?: string | null
          fence?: string
          id?: string
          input_sequence?: number
          lease_until?: string
          message?: string
          patron_key?: string
          result?: Json | null
          rule_version?: string
          save_id?: string
          source_revision?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "dialogue_turns_save_id_actor_id_fkey"
            columns: ["save_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "dialogue_turns_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      game_actions: {
        Row: {
          action_id: string
          actor_id: string
          command_kind: string
          committed_revision: number
          created_at: string
          input_cell_id: string
          input_expected_revision: number
          result: Json
          rules_version: string
          save_id: string
        }
        Insert: {
          action_id: string
          actor_id: string
          command_kind: string
          committed_revision: number
          created_at?: string
          input_cell_id: string
          input_expected_revision: number
          result: Json
          rules_version: string
          save_id: string
        }
        Update: {
          action_id?: string
          actor_id?: string
          command_kind?: string
          committed_revision?: number
          created_at?: string
          input_cell_id?: string
          input_expected_revision?: number
          result?: Json
          rules_version?: string
          save_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_actions_save_id_actor_id_fkey"
            columns: ["save_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "game_actions_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_actions_save_id_input_cell_id_fkey"
            columns: ["save_id", "input_cell_id"]
            isOneToOne: false
            referencedRelation: "garden_cells"
            referencedColumns: ["save_id", "id"]
          },
        ]
      }
      garden_cells: {
        Row: {
          col: number
          growth_stage: number | null
          health: number | null
          id: string
          kind: string
          layout_key: string
          plant_key: string | null
          row: number
          rules_version: string
          save_id: string
          updated_at: string
          water: number | null
        }
        Insert: {
          col: number
          growth_stage?: number | null
          health?: number | null
          id?: string
          kind: string
          layout_key: string
          plant_key?: string | null
          row: number
          rules_version: string
          save_id: string
          updated_at?: string
          water?: number | null
        }
        Update: {
          col?: number
          growth_stage?: number | null
          health?: number | null
          id?: string
          kind?: string
          layout_key?: string
          plant_key?: string | null
          row?: number
          rules_version?: string
          save_id?: string
          updated_at?: string
          water?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "garden_cells_rules_version_plant_key_fkey"
            columns: ["rules_version", "plant_key"]
            isOneToOne: false
            referencedRelation: "plant_catalog"
            referencedColumns: ["rules_version", "plant_key"]
          },
          {
            foreignKeyName: "garden_cells_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_batches: {
        Row: {
          bake_bonus: number
          brew_bonus: number
          consumed_quantity: number
          created_at: string
          id: string
          plant_key: string
          quality_index: number
          quantity: number
          rules_version: string
          save_id: string
          source_action_id: string
          source_cell_id: string
        }
        Insert: {
          bake_bonus: number
          brew_bonus: number
          consumed_quantity?: number
          created_at?: string
          id?: string
          plant_key: string
          quality_index: number
          quantity: number
          rules_version: string
          save_id: string
          source_action_id: string
          source_cell_id: string
        }
        Update: {
          bake_bonus?: number
          brew_bonus?: number
          consumed_quantity?: number
          created_at?: string
          id?: string
          plant_key?: string
          quality_index?: number
          quantity?: number
          rules_version?: string
          save_id?: string
          source_action_id?: string
          source_cell_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_batches_rules_version_plant_key_fkey"
            columns: ["rules_version", "plant_key"]
            isOneToOne: false
            referencedRelation: "plant_catalog"
            referencedColumns: ["rules_version", "plant_key"]
          },
          {
            foreignKeyName: "ingredient_batches_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_batches_save_id_source_action_id_fkey"
            columns: ["save_id", "source_action_id"]
            isOneToOne: true
            referencedRelation: "game_actions"
            referencedColumns: ["save_id", "action_id"]
          },
          {
            foreignKeyName: "ingredient_batches_save_id_source_cell_id_fkey"
            columns: ["save_id", "source_cell_id"]
            isOneToOne: false
            referencedRelation: "garden_cells"
            referencedColumns: ["save_id", "id"]
          },
        ]
      }
      patron_catalog: {
        Row: {
          arc_steps: string[]
          arc_title: string
          description: string
          display_name: string
          icon: string
          initial_relationship: number
          patron_key: string
          prices: number[]
          rules_version: string
          title: string
        }
        Insert: {
          arc_steps: string[]
          arc_title: string
          description: string
          display_name: string
          icon: string
          initial_relationship: number
          patron_key: string
          prices: number[]
          rules_version: string
          title: string
        }
        Update: {
          arc_steps?: string[]
          arc_title?: string
          description?: string
          display_name?: string
          icon?: string
          initial_relationship?: number
          patron_key?: string
          prices?: number[]
          rules_version?: string
          title?: string
        }
        Relationships: []
      }
      patron_states: {
        Row: {
          arc_progress: number
          patron_key: string
          relationship: number
          save_id: string
          updated_at: string
        }
        Insert: {
          arc_progress?: number
          patron_key: string
          relationship: number
          save_id: string
          updated_at?: string
        }
        Update: {
          arc_progress?: number
          patron_key?: string
          relationship?: number
          save_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patron_states_patron_key_fkey"
            columns: ["patron_key"]
            isOneToOne: false
            referencedRelation: "patron_catalog"
            referencedColumns: ["patron_key"]
          },
          {
            foreignKeyName: "patron_states_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      plant_catalog: {
        Row: {
          base_bake_bonus: number
          base_brew_bonus: number
          display_name: string
          icon: string
          plant_key: string
          rules_version: string
        }
        Insert: {
          base_bake_bonus: number
          base_brew_bonus: number
          display_name: string
          icon: string
          plant_key: string
          rules_version: string
        }
        Update: {
          base_bake_bonus?: number
          base_brew_bonus?: number
          display_name?: string
          icon?: string
          plant_key?: string
          rules_version?: string
        }
        Relationships: []
      }
      serving_events: {
        Row: {
          action_id: string
          actor_id: string
          arc_change: number
          beverage_id: string
          card_id: string | null
          committed_revision: number
          created_at: string
          day_number: number
          gold_earned: number
          input_expected_revision: number
          patron_key: string
          relationship_change: number
          result: Json
          rules_version: string
          save_id: string
        }
        Insert: {
          action_id: string
          actor_id: string
          arc_change: number
          beverage_id: string
          card_id?: string | null
          committed_revision: number
          created_at?: string
          day_number: number
          gold_earned: number
          input_expected_revision: number
          patron_key: string
          relationship_change: number
          result: Json
          rules_version: string
          save_id: string
        }
        Update: {
          action_id?: string
          actor_id?: string
          arc_change?: number
          beverage_id?: string
          card_id?: string | null
          committed_revision?: number
          created_at?: string
          day_number?: number
          gold_earned?: number
          input_expected_revision?: number
          patron_key?: string
          relationship_change?: number
          result?: Json
          rules_version?: string
          save_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "serving_events_patron_key_fkey"
            columns: ["patron_key"]
            isOneToOne: false
            referencedRelation: "patron_catalog"
            referencedColumns: ["patron_key"]
          },
          {
            foreignKeyName: "serving_events_save_id_actor_id_fkey"
            columns: ["save_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "serving_events_save_id_beverage_id_fkey"
            columns: ["save_id", "beverage_id"]
            isOneToOne: true
            referencedRelation: "beverages"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "serving_events_save_id_card_id_fkey"
            columns: ["save_id", "card_id"]
            isOneToOne: true
            referencedRelation: "social_cards"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "serving_events_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      social_cards: {
        Row: {
          card_key: string
          created_at: string
          display_name: string
          gold_multiplier: number
          id: string
          relationship_gain: number
          save_id: string
          source_beverage_id: string
          tier: string
        }
        Insert: {
          card_key: string
          created_at?: string
          display_name: string
          gold_multiplier: number
          id?: string
          relationship_gain: number
          save_id: string
          source_beverage_id: string
          tier: string
        }
        Update: {
          card_key?: string
          created_at?: string
          display_name?: string
          gold_multiplier?: number
          id?: string
          relationship_gain?: number
          save_id?: string
          source_beverage_id?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_cards_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_cards_save_id_source_beverage_id_fkey"
            columns: ["save_id", "source_beverage_id"]
            isOneToOne: true
            referencedRelation: "beverages"
            referencedColumns: ["save_id", "id"]
          },
        ]
      }
      tavern_saves: {
        Row: {
          created_at: string
          current_day: number
          day_minigame_completed: boolean
          gold: number
          id: string
          revision: number
          rules_version: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_day?: number
          day_minigame_completed?: boolean
          gold?: number
          id?: string
          revision?: number
          rules_version?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_day?: number
          day_minigame_completed?: boolean
          gold?: number
          id?: string
          revision?: number
          rules_version?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_tavern_day: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_save_id: string
        }
        Returns: Json
      }
      complete_brew: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_good_ticks: number
          p_perfect_ticks: number
          p_save_id: string
          p_session_id: string
          p_total_ticks: number
        }
        Returns: Json
      }
      create_tavern: { Args: never; Returns: Json }
      dialogue_begin: {
        Args: {
          p_actor: string
          p_beverage?: string
          p_card?: string
          p_message: string
          p_patron: string
          p_sequence: number
          p_turn: string
        }
        Returns: Json
      }
      dialogue_checkpoint: {
        Args: {
          p_actor: string
          p_fence: string
          p_stage: string
          p_turn: string
          p_value?: Json
        }
        Returns: undefined
      }
      dialogue_complete: {
        Args: { p_actor: string; p_fence: string; p_turn: string }
        Returns: Json
      }
      dialogue_context: {
        Args: {
          p_actor: string
          p_category?: string
          p_query?: string
          p_turn: string
        }
        Returns: Json
      }
      dialogue_status: {
        Args: { p_cancel?: boolean; p_turn: string }
        Returns: Json
      }
      get_bar_snapshot: { Args: never; Returns: Json }
      get_npc_journal: { Args: { p_patron: string }; Returns: Json }
      get_tavern_snapshot: { Args: never; Returns: Json }
      harvest_crop: {
        Args: {
          p_action_id: string
          p_cell_id: string
          p_expected_revision: number
          p_save_id: string
        }
        Returns: Json
      }
      serve_beverage: {
        Args: {
          p_action_id?: string
          p_beverage_id: string
          p_card_id?: string
          p_expected_revision?: number
          p_patron_key: string
          p_save_id: string
        }
        Returns: Json
      }
      start_brew: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_ingredient_batch_id: string
          p_save_id: string
        }
        Returns: Json
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

