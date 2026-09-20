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
      apiary_colonies: {
        Row: {
          adults: number
          brood: number
          chalkbrood_pressure: number
          established_day: number
          feed_stores: number
          floral_honey: number
          food_stores: number
          health: number
          hive_id: string
          id: string
          nosema_pressure: number
          save_id: string
          threat_days: number
          treatment_days_remaining: number
          treatment_key: string | null
          treatment_tradeoff: string | null
          updated_at: string
          varroa_pressure: number
        }
        Insert: {
          adults?: number
          brood?: number
          chalkbrood_pressure?: number
          established_day: number
          feed_stores?: number
          floral_honey?: number
          food_stores?: number
          health?: number
          hive_id: string
          id?: string
          nosema_pressure?: number
          save_id: string
          threat_days?: number
          treatment_days_remaining?: number
          treatment_key?: string | null
          treatment_tradeoff?: string | null
          updated_at?: string
          varroa_pressure?: number
        }
        Update: {
          adults?: number
          brood?: number
          chalkbrood_pressure?: number
          established_day?: number
          feed_stores?: number
          floral_honey?: number
          food_stores?: number
          health?: number
          hive_id?: string
          id?: string
          nosema_pressure?: number
          save_id?: string
          threat_days?: number
          treatment_days_remaining?: number
          treatment_key?: string | null
          treatment_tradeoff?: string | null
          updated_at?: string
          varroa_pressure?: number
        }
        Relationships: [
          {
            foreignKeyName: "apiary_colonies_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apiary_colonies_save_id_hive_id_fkey"
            columns: ["save_id", "hive_id"]
            isOneToOne: true
            referencedRelation: "apiary_hives"
            referencedColumns: ["save_id", "id"]
          },
        ]
      }
      apiary_hives: {
        Row: {
          cell_id: string
          equipment_condition: number
          id: string
          installed_day: number
          save_id: string
          updated_at: string
        }
        Insert: {
          cell_id: string
          equipment_condition?: number
          id?: string
          installed_day: number
          save_id: string
          updated_at?: string
        }
        Update: {
          cell_id?: string
          equipment_condition?: number
          id?: string
          installed_day?: number
          save_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "apiary_hives_save_id_cell_id_fkey"
            columns: ["save_id", "cell_id"]
            isOneToOne: true
            referencedRelation: "garden_cells"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "apiary_hives_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      bake_actions: {
        Row: {
          action_id: string
          actor_id: string
          command_kind: string
          committed_revision: number
          created_at: string
          input_expected_revision: number
          input_value: number | null
          result: Json
          save_id: string
          subject_id: string
        }
        Insert: {
          action_id: string
          actor_id: string
          command_kind: string
          committed_revision: number
          created_at?: string
          input_expected_revision: number
          input_value?: number | null
          result: Json
          save_id: string
          subject_id: string
        }
        Update: {
          action_id?: string
          actor_id?: string
          command_kind?: string
          committed_revision?: number
          created_at?: string
          input_expected_revision?: number
          input_value?: number | null
          result?: Json
          save_id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bake_actions_save_id_actor_id_fkey"
            columns: ["save_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "bake_actions_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      bake_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          day_number: number
          fold_count: number
          fold_points: number
          id: string
          ingredient_bake_bonus: number
          ingredient_batch_id: string
          ingredient_quality_index: number
          oven_elapsed_ms: number | null
          oven_started_at: string | null
          quality_index: number | null
          recipe_key: string
          rules_version: string
          save_id: string
          score_count: number
          score_points: number
          status: string
          technique_score: number | null
          timing_band: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          day_number: number
          fold_count?: number
          fold_points?: number
          id?: string
          ingredient_bake_bonus: number
          ingredient_batch_id: string
          ingredient_quality_index: number
          oven_elapsed_ms?: number | null
          oven_started_at?: string | null
          quality_index?: number | null
          recipe_key: string
          rules_version: string
          save_id: string
          score_count?: number
          score_points?: number
          status?: string
          technique_score?: number | null
          timing_band?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          day_number?: number
          fold_count?: number
          fold_points?: number
          id?: string
          ingredient_bake_bonus?: number
          ingredient_batch_id?: string
          ingredient_quality_index?: number
          oven_elapsed_ms?: number | null
          oven_started_at?: string | null
          quality_index?: number | null
          recipe_key?: string
          rules_version?: string
          save_id?: string
          score_count?: number
          score_points?: number
          status?: string
          technique_score?: number | null
          timing_band?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bake_sessions_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bake_sessions_save_id_ingredient_batch_id_fkey"
            columns: ["save_id", "ingredient_batch_id"]
            isOneToOne: false
            referencedRelation: "ingredient_batches"
            referencedColumns: ["save_id", "id"]
          },
        ]
      }
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
          countdown_seconds: number
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
          stir_rules_version: string
          stir_score: number | null
          total_ticks: number | null
        }
        Insert: {
          completed_at?: string | null
          countdown_seconds?: number
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
          stir_rules_version?: string
          stir_score?: number | null
          total_ticks?: number | null
        }
        Update: {
          completed_at?: string | null
          countdown_seconds?: number
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
          stir_rules_version?: string
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
      foods: {
        Row: {
          bake_session_id: string | null
          created_at: string
          day_number: number
          id: string
          ingredient_batch_id: string | null
          name: string
          quality_index: number
          recipe_key: string
          rules_version: string
          save_id: string
          source_action_id: string
        }
        Insert: {
          bake_session_id?: string | null
          created_at?: string
          day_number: number
          id?: string
          ingredient_batch_id?: string | null
          name: string
          quality_index: number
          recipe_key: string
          rules_version?: string
          save_id: string
          source_action_id: string
        }
        Update: {
          bake_session_id?: string | null
          created_at?: string
          day_number?: number
          id?: string
          ingredient_batch_id?: string | null
          name?: string
          quality_index?: number
          recipe_key?: string
          rules_version?: string
          save_id?: string
          source_action_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "foods_save_id_bake_session_id_fkey"
            columns: ["save_id", "bake_session_id"]
            isOneToOne: false
            referencedRelation: "bake_sessions"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "foods_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "foods_save_id_ingredient_batch_id_fkey"
            columns: ["save_id", "ingredient_batch_id"]
            isOneToOne: false
            referencedRelation: "ingredient_batches"
            referencedColumns: ["save_id", "id"]
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
      garden_actions: {
        Row: {
          action_id: string
          actor_id: string
          command_kind: string
          committed_revision: number
          created_at: string
          input_expected_revision: number
          input_payload: Json
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
          input_expected_revision: number
          input_payload: Json
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
          input_expected_revision?: number
          input_payload?: Json
          result?: Json
          rules_version?: string
          save_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "garden_actions_save_id_actor_id_fkey"
            columns: ["save_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "garden_actions_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
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
          site_light: number
          soil_k: number
          soil_moisture: number
          soil_n: number
          soil_p: number
          soil_quality: number
          unlocked: boolean
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
          site_light?: number
          soil_k?: number
          soil_moisture?: number
          soil_n?: number
          soil_p?: number
          soil_quality?: number
          unlocked?: boolean
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
          site_light?: number
          soil_k?: number
          soil_moisture?: number
          soil_n?: number
          soil_p?: number
          soil_quality?: number
          unlocked?: boolean
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
      garden_companion_rules: {
        Row: {
          effect: number
          reason: string
          rules_version: string
          species_a: string
          species_b: string
        }
        Insert: {
          effect: number
          reason: string
          rules_version: string
          species_a: string
          species_b: string
        }
        Update: {
          effect?: number
          reason?: string
          rules_version?: string
          species_a?: string
          species_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "garden_companion_rules_rules_version_species_a_fkey"
            columns: ["rules_version", "species_a"]
            isOneToOne: false
            referencedRelation: "garden_species_profiles"
            referencedColumns: ["rules_version", "species_key"]
          },
          {
            foreignKeyName: "garden_companion_rules_rules_version_species_b_fkey"
            columns: ["rules_version", "species_b"]
            isOneToOne: false
            referencedRelation: "garden_species_profiles"
            referencedColumns: ["rules_version", "species_key"]
          },
        ]
      }
      garden_compost_jobs: {
        Row: {
          cell_id: string
          created_at: string
          id: string
          k_per_release: number
          n_per_release: number
          p_per_release: number
          quality_per_release: number
          ready_day: number
          releases_remaining: number
          save_id: string
          source_kind: string
          source_label: string
        }
        Insert: {
          cell_id: string
          created_at?: string
          id?: string
          k_per_release?: number
          n_per_release?: number
          p_per_release?: number
          quality_per_release?: number
          ready_day: number
          releases_remaining?: number
          save_id: string
          source_kind: string
          source_label: string
        }
        Update: {
          cell_id?: string
          created_at?: string
          id?: string
          k_per_release?: number
          n_per_release?: number
          p_per_release?: number
          quality_per_release?: number
          ready_day?: number
          releases_remaining?: number
          save_id?: string
          source_kind?: string
          source_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "garden_compost_jobs_save_id_cell_id_fkey"
            columns: ["save_id", "cell_id"]
            isOneToOne: false
            referencedRelation: "garden_cells"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "garden_compost_jobs_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      garden_daily_grants: {
        Row: {
          contents: Json
          created_at: string
          day_number: number
          grant_key: string
          save_id: string
        }
        Insert: {
          contents: Json
          created_at?: string
          day_number: number
          grant_key: string
          save_id: string
        }
        Update: {
          contents?: Json
          created_at?: string
          day_number?: number
          grant_key?: string
          save_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "garden_daily_grants_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      garden_day_resolutions: {
        Row: {
          action_id: string
          created_at: string
          day_number: number
          input_fingerprint: string
          plan: Json
          plan_fingerprint: string
          report: Json
          rules_version: string
          save_id: string
        }
        Insert: {
          action_id: string
          created_at?: string
          day_number: number
          input_fingerprint: string
          plan: Json
          plan_fingerprint: string
          report: Json
          rules_version: string
          save_id: string
        }
        Update: {
          action_id?: string
          created_at?: string
          day_number?: number
          input_fingerprint?: string
          plan?: Json
          plan_fingerprint?: string
          report?: Json
          rules_version?: string
          save_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "garden_day_resolutions_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      garden_inventory: {
        Row: {
          item_key: string
          quantity: number
          rules_version: string
          save_id: string
          updated_at: string
        }
        Insert: {
          item_key: string
          quantity?: number
          rules_version?: string
          save_id: string
          updated_at?: string
        }
        Update: {
          item_key?: string
          quantity?: number
          rules_version?: string
          save_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "garden_inventory_rules_version_item_key_fkey"
            columns: ["rules_version", "item_key"]
            isOneToOne: false
            referencedRelation: "garden_item_catalog"
            referencedColumns: ["rules_version", "item_key"]
          },
          {
            foreignKeyName: "garden_inventory_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      garden_item_catalog: {
        Row: {
          display_name: string
          effect: Json
          item_key: string
          item_kind: string
          price: number
          rules_version: string
        }
        Insert: {
          display_name: string
          effect?: Json
          item_key: string
          item_kind: string
          price: number
          rules_version: string
        }
        Update: {
          display_name?: string
          effect?: Json
          item_key?: string
          item_kind?: string
          price?: number
          rules_version?: string
        }
        Relationships: []
      }
      garden_plants: {
        Row: {
          age_days: number
          care_good_days: number
          care_total_days: number
          cell_id: string
          companion_points: number
          flowering_days_remaining: number
          growth_progress: number
          health: number
          id: string
          lifecycle: string
          planted_day: number
          pollination_points: number
          production_cycle: number
          ready_since_day: number | null
          rules_version: string
          save_id: string
          species_key: string
          stress_points: number
          threat_days: number
          updated_at: string
        }
        Insert: {
          age_days?: number
          care_good_days?: number
          care_total_days?: number
          cell_id: string
          companion_points?: number
          flowering_days_remaining?: number
          growth_progress?: number
          health?: number
          id?: string
          lifecycle: string
          planted_day: number
          pollination_points?: number
          production_cycle?: number
          ready_since_day?: number | null
          rules_version: string
          save_id: string
          species_key: string
          stress_points?: number
          threat_days?: number
          updated_at?: string
        }
        Update: {
          age_days?: number
          care_good_days?: number
          care_total_days?: number
          cell_id?: string
          companion_points?: number
          flowering_days_remaining?: number
          growth_progress?: number
          health?: number
          id?: string
          lifecycle?: string
          planted_day?: number
          pollination_points?: number
          production_cycle?: number
          ready_since_day?: number | null
          rules_version?: string
          save_id?: string
          species_key?: string
          stress_points?: number
          threat_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "garden_plants_rules_version_species_key_fkey"
            columns: ["rules_version", "species_key"]
            isOneToOne: false
            referencedRelation: "garden_species_profiles"
            referencedColumns: ["rules_version", "species_key"]
          },
          {
            foreignKeyName: "garden_plants_save_id_cell_id_fkey"
            columns: ["save_id", "cell_id"]
            isOneToOne: true
            referencedRelation: "garden_cells"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "garden_plants_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      garden_shop_stock: {
        Row: {
          daily_cap: number
          item_key: string
          remaining_quantity: number
          restock_day: number
          rules_version: string
          save_id: string
          updated_at: string
        }
        Insert: {
          daily_cap: number
          item_key: string
          remaining_quantity: number
          restock_day: number
          rules_version: string
          save_id: string
          updated_at?: string
        }
        Update: {
          daily_cap?: number
          item_key?: string
          remaining_quantity?: number
          restock_day?: number
          rules_version?: string
          save_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "garden_shop_stock_rules_version_item_key_fkey"
            columns: ["rules_version", "item_key"]
            isOneToOne: false
            referencedRelation: "garden_item_catalog"
            referencedColumns: ["rules_version", "item_key"]
          },
          {
            foreignKeyName: "garden_shop_stock_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      garden_species_profiles: {
        Row: {
          base_bake_bonus: number
          base_brew_bonus: number
          base_yield: number
          display_name: string
          flowering_days: number
          flowering_start: number
          forage_value: number
          height_class: number
          icon: string
          k_max: number
          k_min: number
          k_use: number
          light_max: number
          light_min: number
          maturity_days: number
          moisture_max: number
          moisture_min: number
          n_max: number
          n_min: number
          n_use: number
          p_max: number
          p_min: number
          p_use: number
          pollination_eligible: boolean
          primary_product: string
          regrows: boolean
          regrowth_days: number | null
          rules_version: string
          species_key: string
        }
        Insert: {
          base_bake_bonus: number
          base_brew_bonus: number
          base_yield: number
          display_name: string
          flowering_days: number
          flowering_start: number
          forage_value: number
          height_class: number
          icon: string
          k_max: number
          k_min: number
          k_use: number
          light_max: number
          light_min: number
          maturity_days: number
          moisture_max: number
          moisture_min: number
          n_max: number
          n_min: number
          n_use: number
          p_max: number
          p_min: number
          p_use: number
          pollination_eligible: boolean
          primary_product: string
          regrows: boolean
          regrowth_days?: number | null
          rules_version: string
          species_key: string
        }
        Update: {
          base_bake_bonus?: number
          base_brew_bonus?: number
          base_yield?: number
          display_name?: string
          flowering_days?: number
          flowering_start?: number
          forage_value?: number
          height_class?: number
          icon?: string
          k_max?: number
          k_min?: number
          k_use?: number
          light_max?: number
          light_min?: number
          maturity_days?: number
          moisture_max?: number
          moisture_min?: number
          n_max?: number
          n_min?: number
          n_use?: number
          p_max?: number
          p_min?: number
          p_use?: number
          pollination_eligible?: boolean
          primary_product?: string
          regrows?: boolean
          regrowth_days?: number | null
          rules_version?: string
          species_key?: string
        }
        Relationships: []
      }
      garden_weather: {
        Row: {
          day_number: number
          rules_version: string
          save_id: string
          weather_key: string
        }
        Insert: {
          day_number: number
          rules_version: string
          save_id: string
          weather_key: string
        }
        Update: {
          day_number?: number
          rules_version?: string
          save_id?: string
          weather_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "garden_weather_rules_version_weather_key_fkey"
            columns: ["rules_version", "weather_key"]
            isOneToOne: false
            referencedRelation: "garden_weather_profiles"
            referencedColumns: ["rules_version", "weather_key"]
          },
          {
            foreignKeyName: "garden_weather_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
        ]
      }
      garden_weather_profiles: {
        Row: {
          display_name: string
          drying: number
          light_delta: number
          rainfall: number
          rules_version: string
          weather_key: string
        }
        Insert: {
          display_name: string
          drying: number
          light_delta: number
          rainfall: number
          rules_version: string
          weather_key: string
        }
        Update: {
          display_name?: string
          drying?: number
          light_delta?: number
          rainfall?: number
          rules_version?: string
          weather_key?: string
        }
        Relationships: []
      }
      ingredient_batches: {
        Row: {
          bake_bonus: number
          brew_bonus: number
          composted_quantity: number
          consumed_quantity: number
          created_at: string
          id: string
          plant_key: string
          provenance: Json
          quality_index: number
          quantity: number
          rules_version: string
          save_id: string
          source_action_id: string | null
          source_apiary_action_id: string | null
          source_cell_id: string
          source_kind: string
        }
        Insert: {
          bake_bonus: number
          brew_bonus: number
          composted_quantity?: number
          consumed_quantity?: number
          created_at?: string
          id?: string
          plant_key: string
          provenance?: Json
          quality_index: number
          quantity: number
          rules_version: string
          save_id: string
          source_action_id?: string | null
          source_apiary_action_id?: string | null
          source_cell_id: string
          source_kind?: string
        }
        Update: {
          bake_bonus?: number
          brew_bonus?: number
          composted_quantity?: number
          consumed_quantity?: number
          created_at?: string
          id?: string
          plant_key?: string
          provenance?: Json
          quality_index?: number
          quantity?: number
          rules_version?: string
          save_id?: string
          source_action_id?: string | null
          source_apiary_action_id?: string | null
          source_cell_id?: string
          source_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_batches_apiary_source_fkey"
            columns: ["save_id", "source_apiary_action_id"]
            isOneToOne: true
            referencedRelation: "garden_actions"
            referencedColumns: ["save_id", "action_id"]
          },
          {
            foreignKeyName: "ingredient_batches_crop_source_fkey"
            columns: ["save_id", "source_action_id"]
            isOneToOne: true
            referencedRelation: "game_actions"
            referencedColumns: ["save_id", "action_id"]
          },
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
            foreignKeyName: "ingredient_batches_save_id_source_cell_id_fkey"
            columns: ["save_id", "source_cell_id"]
            isOneToOne: false
            referencedRelation: "garden_cells"
            referencedColumns: ["save_id", "id"]
          },
        ]
      }
      intent_card_catalog: {
        Row: {
          card_key: string
          description: string
          display_name: string
          prompt_instruction: string
          version: string
        }
        Insert: {
          card_key: string
          description: string
          display_name: string
          prompt_instruction: string
          version: string
        }
        Update: {
          card_key?: string
          description?: string
          display_name?: string
          prompt_instruction?: string
          version?: string
        }
        Relationships: []
      }
      intent_cards: {
        Row: {
          card_key: string
          catalog_version: string
          created_at: string
          id: string
          save_id: string
          source_beverage_id: string | null
          source_food_id: string | null
          source_key: string
          source_kind: string
          tier: string
        }
        Insert: {
          card_key: string
          catalog_version?: string
          created_at?: string
          id?: string
          save_id: string
          source_beverage_id?: string | null
          source_food_id?: string | null
          source_key: string
          source_kind: string
          tier: string
        }
        Update: {
          card_key?: string
          catalog_version?: string
          created_at?: string
          id?: string
          save_id?: string
          source_beverage_id?: string | null
          source_food_id?: string | null
          source_key?: string
          source_kind?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "intent_cards_card_key_catalog_version_fkey"
            columns: ["card_key", "catalog_version"]
            isOneToOne: false
            referencedRelation: "intent_card_catalog"
            referencedColumns: ["card_key", "version"]
          },
          {
            foreignKeyName: "intent_cards_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intent_cards_save_id_source_beverage_id_fkey"
            columns: ["save_id", "source_beverage_id"]
            isOneToOne: false
            referencedRelation: "beverages"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "intent_cards_save_id_source_food_id_fkey"
            columns: ["save_id", "source_food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["save_id", "id"]
          },
        ]
      }
      npc_daily_analytics: {
        Row: {
          abandonments: number
          active_worlds: number
          assignments: number
          campaign_completions: number
          days_present: number
          dialogue_turns: number
          dismissals: number
          event_day: string
          hospitality_interactions: number
          milestone_failures: number
          milestone_successes: number
          report_band: string
          version_id: string
        }
        Insert: {
          abandonments?: number
          active_worlds?: number
          assignments?: number
          campaign_completions?: number
          days_present?: number
          dialogue_turns?: number
          dismissals?: number
          event_day: string
          hospitality_interactions?: number
          milestone_failures?: number
          milestone_successes?: number
          report_band?: string
          version_id: string
        }
        Update: {
          abandonments?: number
          active_worlds?: number
          assignments?: number
          campaign_completions?: number
          days_present?: number
          dialogue_turns?: number
          dismissals?: number
          event_day?: string
          hospitality_interactions?: number
          milestone_failures?: number
          milestone_successes?: number
          report_band?: string
          version_id?: string
        }
        Relationships: []
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
      player_profiles: {
        Row: {
          adult_attested_at: string | null
          bio: string
          created_at: string
          creator_terms_accepted_at: string | null
          creator_terms_version: string | null
          display_name: string
          mature_content_enabled: boolean
          normalized_display_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          adult_attested_at?: string | null
          bio?: string
          created_at?: string
          creator_terms_accepted_at?: string | null
          creator_terms_version?: string | null
          display_name: string
          mature_content_enabled?: boolean
          normalized_display_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          adult_attested_at?: string | null
          bio?: string
          created_at?: string
          creator_terms_accepted_at?: string | null
          creator_terms_version?: string | null
          display_name?: string
          mature_content_enabled?: boolean
          normalized_display_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          community_npc_level: number
          created_at: string
          current_day: number
          daily_craft_kind: string | null
          day_minigame_completed: boolean
          garden_plot_count: number
          garden_rules_version: string
          gold: number
          id: string
          revision: number
          rules_version: string
          updated_at: string
          user_id: string
          world_phase: string
        }
        Insert: {
          community_npc_level?: number
          created_at?: string
          current_day?: number
          daily_craft_kind?: string | null
          day_minigame_completed?: boolean
          garden_plot_count?: number
          garden_rules_version?: string
          gold?: number
          id?: string
          revision?: number
          rules_version?: string
          updated_at?: string
          user_id: string
          world_phase?: string
        }
        Update: {
          community_npc_level?: number
          created_at?: string
          current_day?: number
          daily_craft_kind?: string | null
          day_minigame_completed?: boolean
          garden_plot_count?: number
          garden_rules_version?: string
          gold?: number
          id?: string
          revision?: number
          rules_version?: string
          updated_at?: string
          user_id?: string
          world_phase?: string
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
      apiary_command: {
        Args: {
          p_action_id: string
          p_command_kind: string
          p_expected_revision: number
          p_payload: Json
          p_save_id: string
        }
        Returns: Json
      }
      begin_bake_oven: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_save_id: string
          p_session_id: string
        }
        Returns: Json
      }
      complete_bake: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_save_id: string
          p_session_id: string
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
      fold_bake: {
        Args: {
          p_action_id: string
          p_distance: number
          p_expected_revision: number
          p_save_id: string
          p_session_id: string
        }
        Returns: Json
      }
      garden_command: {
        Args: {
          p_action_id: string
          p_command_kind: string
          p_expected_revision: number
          p_payload: Json
          p_save_id: string
        }
        Returns: Json
      }
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
      npc_admin_audit: {
        Args: { p_cursor?: string; p_kind?: string; p_limit?: number }
        Returns: Json
      }
      npc_admin_quarantine_or_purge: {
        Args: { p_npc: string; p_purge: boolean; p_reason: string }
        Returns: undefined
      }
      npc_admin_release_name: {
        Args: { p_npc: string; p_reason: string }
        Returns: undefined
      }
      npc_admin_set_capability: {
        Args: {
          p_capability: string
          p_enabled: boolean
          p_reason?: string
          p_user: string
        }
        Returns: undefined
      }
      npc_admin_transfer: {
        Args: { p_new_owner: string; p_npc: string; p_reason: string }
        Returns: undefined
      }
      npc_admin_users: {
        Args: { p_limit?: number; p_query?: string }
        Returns: Json
      }
      npc_appeal_report: {
        Args: { p_body: string; p_report: string }
        Returns: string
      }
      npc_archived_resident: { Args: { p_instance: string }; Returns: Json }
      npc_archived_roster: {
        Args: { p_cursor?: string; p_limit?: number; p_query?: string }
        Returns: Json
      }
      npc_author_add_scene: {
        Args: {
          p_alt_text: string
          p_generation?: Json
          p_npc_id: string
          p_storage_key: string
        }
        Returns: Json
      }
      npc_author_analytics: { Args: never; Returns: Json }
      npc_author_assistance_complete: {
        Args: { p_error_code?: string; p_job_id: string; p_proposal: Json }
        Returns: undefined
      }
      npc_author_assistance_disposition: {
        Args: {
          p_accept: boolean
          p_event_id: string
          p_expected_revision: number
        }
        Returns: Json
      }
      npc_author_assistance_status: {
        Args: { p_event_id: string }
        Returns: Json
      }
      npc_author_create: { Args: { p_sheet: Json }; Returns: Json }
      npc_author_discard_portrait_candidate: {
        Args: {
          p_candidate_id: string
          p_expected_revision: number
          p_npc_id: string
        }
        Returns: Json
      }
      npc_author_expression_sprite_workspace: {
        Args: { p_npc_id: string }
        Returns: Json
      }
      npc_author_list_settings: { Args: never; Returns: Json }
      npc_author_portrait_complete: {
        Args: { p_candidates: Json; p_error_code?: string; p_job_id: string }
        Returns: Json
      }
      npc_author_portrait_event_status: {
        Args: { p_job_id: string }
        Returns: Json
      }
      npc_author_portrait_preview_authorization: {
        Args: { p_token: string }
        Returns: Json
      }
      npc_author_portrait_preview_target: {
        Args: { p_asset_id: string }
        Returns: Json
      }
      npc_author_portrait_status: { Args: { p_job_id: string }; Returns: Json }
      npc_author_register_setting_asset: {
        Args: {
          p_height: number
          p_mime_type: string
          p_setting_id: string
          p_sha256: string
          p_storage_key: string
          p_width: number
        }
        Returns: Json
      }
      npc_author_register_uploaded_portrait: {
        Args: {
          p_expected_revision: number
          p_metadata: Json
          p_npc_id: string
          p_slot: string
        }
        Returns: Json
      }
      npc_author_request_assistance: {
        Args: {
          p_expected_revision: number
          p_instruction: string
          p_npc_id: string
          p_section_path: string
        }
        Returns: Json
      }
      npc_author_request_portrait:
        | {
            Args: {
              p_alternatives?: number
              p_controls: Json
              p_expected_revision: number
              p_npc_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_alternatives: number
              p_controls: Json
              p_expected_revision: number
              p_npc_id: string
              p_slot: string
            }
            Returns: Json
          }
      npc_author_request_retirement: {
        Args: { p_npc_id: string; p_reason: string }
        Returns: Json
      }
      npc_author_request_scene: {
        Args: {
          p_alternative?: number
          p_expected_revision: number
          p_npc_id: string
          p_prompt: string
        }
        Returns: Json
      }
      npc_author_reserve_call: {
        Args: { p_kind: string; p_npc_id: string; p_request?: Json }
        Returns: Json
      }
      npc_author_resolve_review_comment: {
        Args: { p_comment_id: string }
        Returns: undefined
      }
      npc_author_sandbox_complete: {
        Args: { p_error_code?: string; p_job_id: string; p_reply: string }
        Returns: undefined
      }
      npc_author_sandbox_send: {
        Args: { p_message: string; p_sandbox_id: string }
        Returns: Json
      }
      npc_author_sandbox_start:
        | {
            Args: { p_expected_revision: number; p_npc_id: string }
            Returns: Json
          }
        | {
            Args: {
              p_expected_revision: number
              p_message: string
              p_npc_id: string
            }
            Returns: Json
          }
      npc_author_sandbox_status: {
        Args: { p_sandbox_id: string }
        Returns: Json
      }
      npc_author_save: {
        Args: { p_expected_revision: number; p_npc_id: string; p_sheet: Json }
        Returns: Json
      }
      npc_author_scene_complete: {
        Args: { p_candidates: Json; p_error_code?: string; p_job_id: string }
        Returns: Json
      }
      npc_author_scene_status: { Args: { p_job_id: string }; Returns: Json }
      npc_author_select_portrait:
        | {
            Args: {
              p_asset_id: string
              p_expected_revision: number
              p_npc_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_candidate_id: string
              p_confirm_stale?: boolean
              p_expected_revision: number
              p_npc_id: string
              p_slot: string
            }
            Returns: Json
          }
      npc_author_select_scene: {
        Args: {
          p_asset_id: string
          p_expected_revision: number
          p_npc_id: string
        }
        Returns: Json
      }
      npc_author_select_setting: {
        Args: {
          p_expected_revision: number
          p_npc_id: string
          p_setting_id: string
        }
        Returns: Json
      }
      npc_author_set_portrait_provider_status: {
        Args: {
          p_available: boolean
          p_expires_in_seconds?: number
          p_failure_code?: string
          p_model: string
          p_provider: string
        }
        Returns: undefined
      }
      npc_author_submit: {
        Args: { p_expected_revision: number; p_npc_id: string }
        Returns: Json
      }
      npc_author_workspace: { Args: never; Returns: Json }
      npc_author_workspace_detail: { Args: { p_npc_id: string }; Returns: Json }
      npc_bar_snapshot: { Args: never; Returns: Json }
      npc_bar_summary: { Args: never; Returns: Json }
      npc_bootstrap_admin: { Args: { p_user: string }; Returns: undefined }
      npc_dialogue_begin: {
        Args: {
          p_actor: string
          p_expected_sequence: number
          p_intent_card_id?: string
          p_message: string
          p_npc_id: string
          p_offering_item_id?: string
          p_offering_kind?: string
          p_turn_id: string
        }
        Returns: Json
      }
      npc_dialogue_checkpoint: {
        Args: {
          p_actor: string
          p_fence: string
          p_stage: string
          p_turn_id: string
          p_value?: Json
        }
        Returns: undefined
      }
      npc_dialogue_complete: {
        Args: { p_actor: string; p_fence: string; p_turn_id: string }
        Returns: Json
      }
      npc_dialogue_context: {
        Args: {
          p_actor: string
          p_category?: string
          p_query?: string
          p_turn_id: string
        }
        Returns: Json
      }
      npc_dialogue_status: {
        Args: { p_cancel?: boolean; p_turn_id: string }
        Returns: Json
      }
      npc_dismiss: { Args: { p_instance: string }; Returns: undefined }
      npc_evaluation_complete: {
        Args: { p_error_code?: string; p_result: Json; p_version: string }
        Returns: undefined
      }
      npc_generation_complete: {
        Args: { p_error_code?: string; p_job: string; p_result: Json }
        Returns: undefined
      }
      npc_inbox: { Args: { p_limit?: number }; Returns: Json }
      npc_inbox_mark_read: { Args: { p_ids: string[] }; Returns: number }
      npc_journals: { Args: { p_instance_ids: string[] }; Returns: Json }
      npc_local_assign_first_party_author: {
        Args: { p_owner_id: string }
        Returns: Json
      }
      npc_my_capabilities: { Args: never; Returns: Json }
      npc_portrait_claim_generation_attempt: { Args: never; Returns: Json }
      npc_portrait_complete_generation_attempt: {
        Args: {
          p_attempt_id: string
          p_error_code?: string
          p_lease_token: string
          p_result: Json
        }
        Returns: Json
      }
      npc_portrait_deletion_complete: {
        Args: { p_asset_id: string; p_claim_token: string }
        Returns: undefined
      }
      npc_portrait_heartbeat_generation_attempt: {
        Args: { p_attempt_id: string; p_lease_token: string }
        Returns: undefined
      }
      npc_portrait_mark_generation_dispatched: {
        Args: { p_attempt_id: string; p_lease_token: string }
        Returns: undefined
      }
      npc_portrait_next_deletion_target: { Args: never; Returns: Json }
      npc_profile_me: { Args: never; Returns: Json }
      npc_public_creator: { Args: { p_normalized_name: string }; Returns: Json }
      npc_public_creator_npcs: {
        Args: { p_cursor?: string; p_limit?: number; p_normalized_name: string }
        Returns: Json
      }
      npc_record_engagement: {
        Args: {
          p_actor: string
          p_kind: string
          p_metadata?: Json
          p_version: string
        }
        Returns: undefined
      }
      npc_report: {
        Args: { p_category: string; p_evidence: string; p_version: string }
        Returns: string
      }
      npc_request_retirement: {
        Args: { p_npc: string; p_reason: string }
        Returns: string
      }
      npc_resident: { Args: { p_instance: string }; Returns: Json }
      npc_resident_package_observations_recent: {
        Args: { p_limit?: number }
        Returns: {
          actor_id: string
          duration_ms: number
          error_code: string
          id: number
          instance_id: string
          npc_id: string
          occurred_at: string
          operation: string
          package_hash: string
          package_id: string
          save_id: string
          source_kind: string
          status: string
          version_id: string
        }[]
      }
      npc_resident_package_record_failure: {
        Args: {
          p_actor_id: string
          p_duration_ms?: number
          p_error_code?: string
          p_instance_id?: string
          p_npc_id: string
          p_operation: string
          p_package_hash?: string
          p_package_id?: string
          p_save_id?: string
          p_source_kind: string
          p_version_id: string
        }
        Returns: undefined
      }
      npc_reviewer_comment: {
        Args: {
          p_body: string
          p_npc_id: string
          p_section: string
          p_version_id: string
        }
        Returns: string
      }
      npc_reviewer_decide: {
        Args: {
          p_decision: string
          p_notes?: string
          p_option_ids?: string[]
          p_rating?: string
          p_version_id: string
        }
        Returns: Json
      }
      npc_reviewer_moderation_queue: {
        Args: { p_cursor?: string; p_kind?: string; p_limit?: number }
        Returns: Json
      }
      npc_reviewer_publish: { Args: { p_version_id: string }; Returns: Json }
      npc_reviewer_queue: { Args: never; Returns: Json }
      npc_reviewer_report_detail: {
        Args: { p_report_id: string }
        Returns: Json
      }
      npc_reviewer_resolve_report: {
        Args: {
          p_action: string
          p_creator_reason: string
          p_report: string
          p_reviewer_reason: string
          p_uphold: boolean
        }
        Returns: undefined
      }
      npc_reviewer_retirement: {
        Args: { p_approve: boolean; p_reason: string; p_request: string }
        Returns: undefined
      }
      npc_reviewer_submission: { Args: { p_version_id: string }; Returns: Json }
      npc_rollup_analytics: { Args: { p_day: string }; Returns: undefined }
      npc_roster: {
        Args: { p_cursor?: string; p_limit?: number; p_query?: string }
        Returns: Json
      }
      npc_serve_hospitality: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_instance_id: string
          p_item_id: string
          p_item_kind: string
          p_save_id: string
        }
        Returns: Json
      }
      npc_set_mature_preference: {
        Args: { p_attest?: boolean; p_enabled: boolean }
        Returns: Json
      }
      npc_share_conversation: {
        Args: {
          p_expected_hash: string
          p_include_display_name?: boolean
          p_instance: string
        }
        Returns: string
      }
      npc_share_preview: { Args: { p_instance: string }; Returns: Json }
      npc_share_view: { Args: { p_token: string }; Returns: Json }
      npc_update_community_settings: {
        Args: {
          p_attest_adult: boolean
          p_bio: string
          p_creator_terms: boolean
          p_display_name: string
          p_mature: boolean
        }
        Returns: Json
      }
      npc_update_profile: {
        Args: {
          p_attest_adult: boolean
          p_bio: string
          p_creator_terms: boolean
          p_display_name: string
          p_mature: boolean
        }
        Returns: Json
      }
      npc_world_accept_plan: {
        Args: { p_actor: string; p_instance: string; p_steps: Json }
        Returns: Json
      }
      preview_apiary_command: {
        Args: { p_command_kind: string; p_payload: Json }
        Returns: Json
      }
      preview_garden_command: {
        Args: { p_command_kind: string; p_payload: Json }
        Returns: Json
      }
      project_garden_day: { Args: never; Returns: Json }
      prompt_registry_activate: {
        Args: {
          p_candidates: Json
          p_expected_active_release: string
          p_label: string
          p_reason?: string
          p_warning_acknowledgements?: Json
        }
        Returns: Json
      }
      prompt_registry_create_candidate: {
        Args: {
          p_body: string
          p_change_note?: string
          p_contract_hash: string
          p_contract_id: string
          p_key: string
          p_parent_revision_id?: string
        }
        Returns: Json
      }
      prompt_registry_detail: { Args: { p_key: string }; Returns: Json }
      prompt_registry_recent_runs: {
        Args: { p_limit?: number; p_workflow?: string }
        Returns: Json
      }
      prompt_registry_restore: {
        Args: {
          p_expected_active_release: string
          p_label: string
          p_reason?: string
          p_restore_release: string
          p_warning_acknowledgements?: Json
        }
        Returns: Json
      }
      prompt_registry_service_record_run: {
        Args: {
          p_attempt: number
          p_duration_ms?: number
          p_error_code?: string
          p_execution_id: string
          p_input_tokens?: number
          p_model?: string
          p_node_key: string
          p_output_tokens?: number
          p_prompt_key: string
          p_release_id: string
          p_revision_id: string
          p_status: string
          p_workflow: string
        }
        Returns: undefined
      }
      prompt_registry_service_resolve: {
        Args: { p_release_id?: string }
        Returns: Json
      }
      prompt_registry_service_work_release: {
        Args: { p_work_id: string; p_work_kind: string }
        Returns: string
      }
      prompt_registry_summary: { Args: never; Returns: Json }
      purchase_generated_supply: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_item_key: string
          p_quantity: number
          p_save_id: string
        }
        Returns: Json
      }
      score_bake: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_length: number
          p_save_id: string
          p_session_id: string
        }
        Returns: Json
      }
      start_bake:
        | {
            Args: {
              p_action_id: string
              p_expected_revision: number
              p_ingredient_batch_id: string
              p_save_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_action_id: string
              p_expected_revision: number
              p_ingredient_batch_id: string
              p_recipe_key: string
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
      use_generated_supply: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_item_key: string
          p_quest_id: string
          p_save_id: string
        }
        Returns: Json
      }
      world_demote_low_relevance_deep_npc: {
        Args: { p_reason?: string; p_save_id: string }
        Returns: Json
      }
      world_developer_inspector: { Args: { p_save_id: string }; Returns: Json }
      world_developer_requeue_runtime_art_job: {
        Args: {
          p_actor_id: string
          p_job_id: string
          p_reason: string
          p_save_id: string
        }
        Returns: Json
      }
      world_developer_requeue_settlement_job: {
        Args: {
          p_actor_id: string
          p_job_id: string
          p_reason: string
          p_save_id: string
        }
        Returns: Json
      }
      world_developer_set_runtime_art_appearance: {
        Args: {
          p_actor_id: string
          p_appearance_version: string
          p_entity_id: string
          p_public_appearance: string
          p_reason: string
          p_save_id: string
        }
        Returns: Json
      }
      world_generated_gameplay_availability: {
        Args: { p_save_id: string }
        Returns: Json
      }
      world_generated_shop_projection: {
        Args: { p_save_id: string }
        Returns: Json
      }
      world_irreversible_warning_status: {
        Args: { p_save_id: string }
        Returns: Json
      }
      world_issue_irreversible_entity_warning: {
        Args: {
          p_capability_id: string
          p_public_message: string
          p_save_id: string
          p_target_entity_id: string
        }
        Returns: Json
      }
      world_promote_supporting_actor: {
        Args: { p_entity_id: string; p_reason?: string; p_save_id: string }
        Returns: Json
      }
      world_public_codex: { Args: { p_save_id: string }; Returns: Json }
      world_retire_generated_entity: {
        Args: {
          p_capability_id: string
          p_entity_id: string
          p_input_fingerprint: string
          p_reason?: string
          p_save_id: string
          p_warning_id: string
        }
        Returns: Json
      }
      world_runtime_art_accept: {
        Args: {
          p_attempt: number
          p_fence: string
          p_job_id: string
          p_runtime_key: string
          p_sha256: string
        }
        Returns: Json
      }
      world_runtime_art_authorize_delivery: {
        Args: { p_entity_id: string; p_render_id: string; p_save_id: string }
        Returns: Json
      }
      world_runtime_art_claim_next: {
        Args: { p_lease_seconds?: number }
        Returns: Json
      }
      world_runtime_art_fail: {
        Args: {
          p_attempt: number
          p_fence: string
          p_job_id: string
          p_status: string
        }
        Returns: undefined
      }
      world_runtime_art_projection: {
        Args: { p_save_id: string }
        Returns: Json
      }
      world_runtime_art_replace_accepted: {
        Args: { p_job_id: string; p_runtime_key: string; p_sha256: string }
        Returns: Json
      }
      world_runtime_art_service_runtime_key: {
        Args: { p_render_id: string }
        Returns: Json
      }
      world_runtime_art_set_appearance: {
        Args: {
          p_appearance_version: string
          p_entity_id: string
          p_public_appearance: string
          p_save_id: string
        }
        Returns: undefined
      }
      world_settlement_checkpoint: {
        Args: {
          p_fence: string
          p_job_id: string
          p_model?: string
          p_payload: Json
          p_prompt_version?: string
          p_settlement_id: string
          p_stage: string
          p_usage?: Json
        }
        Returns: Json
      }
      world_settlement_claim: {
        Args: { p_settlement_id: string }
        Returns: Json
      }
      world_settlement_claim_next: { Args: never; Returns: Json }
      world_settlement_commit_canon: {
        Args: {
          p_event: Json
          p_fence: string
          p_job_id: string
          p_settlement_id: string
        }
        Returns: Json
      }
      world_settlement_commit_mutation: {
        Args: {
          p_fence: string
          p_job_id: string
          p_proposal: Json
          p_proposal_fingerprint: string
          p_public_digest: string
          p_settlement_id: string
        }
        Returns: Json
      }
      world_settlement_commit_procedural_world: {
        Args: {
          p_fence: string
          p_job_id: string
          p_proposal: Json
          p_settlement_id: string
        }
        Returns: Json
      }
      world_settlement_commit_social_encounter: {
        Args: {
          p_fence: string
          p_job_id: string
          p_proposal: Json
          p_settlement_id: string
        }
        Returns: Json
      }
      world_settlement_complete: {
        Args: {
          p_fence: string
          p_job_id: string
          p_output?: Json
          p_settlement_id: string
        }
        Returns: Json
      }
      world_settlement_complete_news: {
        Args: { p_fence: string; p_job_id: string; p_settlement_id: string }
        Returns: Json
      }
      world_settlement_enqueue: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_input_snapshot: Json
          p_input_version: string
          p_save_id: string
        }
        Returns: Json
      }
      world_settlement_fail: {
        Args: {
          p_failure_code: string
          p_fence: string
          p_job_id: string
          p_settlement_id: string
        }
        Returns: Json
      }
      world_settlement_heartbeat: {
        Args: { p_fence: string; p_settlement_id: string }
        Returns: Json
      }
      world_settlement_safe_result: {
        Args: {
          p_fence: string
          p_job_id: string
          p_kind: string
          p_public_digest: string
          p_settlement_id: string
        }
        Returns: Json
      }
      world_settlement_status: {
        Args: { p_save_id: string; p_settlement_id?: string }
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

