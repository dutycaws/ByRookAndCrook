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
      tavern_saves: {
        Row: {
          created_at: string
          id: string
          revision: number
          rules_version: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          revision?: number
          rules_version?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
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
      create_tavern: { Args: never; Returns: Json }
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

