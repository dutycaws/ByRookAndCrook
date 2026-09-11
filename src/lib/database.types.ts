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
          intent_card_id: string | null
          intent_snapshot: Json | null
          interaction_version: string
          lease_until: string
          message: string
          offering_beverage_id: string | null
          offering_food_id: string | null
          offering_kind: string | null
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
          intent_card_id?: string | null
          intent_snapshot?: Json | null
          interaction_version?: string
          lease_until: string
          message: string
          offering_beverage_id?: string | null
          offering_food_id?: string | null
          offering_kind?: string | null
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
          intent_card_id?: string | null
          intent_snapshot?: Json | null
          interaction_version?: string
          lease_until?: string
          message?: string
          offering_beverage_id?: string | null
          offering_food_id?: string | null
          offering_kind?: string | null
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
          {
            foreignKeyName: "dialogue_turns_save_id_intent_card_id_fkey"
            columns: ["save_id", "intent_card_id"]
            isOneToOne: false
            referencedRelation: "intent_cards"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "dialogue_turns_save_id_offering_beverage_id_fkey"
            columns: ["save_id", "offering_beverage_id"]
            isOneToOne: false
            referencedRelation: "beverages"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "dialogue_turns_save_id_offering_food_id_fkey"
            columns: ["save_id", "offering_food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["save_id", "id"]
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
          k_min: number
          k_use: number
          light_max: number
          light_min: number
          maturity_days: number
          moisture_max: number
          moisture_min: number
          n_min: number
          n_use: number
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
          k_min: number
          k_use: number
          light_max: number
          light_min: number
          maturity_days: number
          moisture_max: number
          moisture_min: number
          n_min: number
          n_use: number
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
          k_min?: number
          k_use?: number
          light_max?: number
          light_min?: number
          maturity_days?: number
          moisture_max?: number
          moisture_min?: number
          n_min?: number
          n_use?: number
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
      hospitality_events: {
        Row: {
          action_id: string
          actor_id: string
          beverage_id: string | null
          committed_revision: number
          created_at: string
          day_number: number
          food_id: string | null
          gold_earned: number
          input_expected_revision: number
          item_kind: string
          item_name: string
          legacy_card_id: string | null
          patron_key: string
          quality_index: number
          relationship_change: number
          result: Json
          rules_version: string
          save_id: string
          turn_id: string | null
        }
        Insert: {
          action_id: string
          actor_id: string
          beverage_id?: string | null
          committed_revision: number
          created_at?: string
          day_number: number
          food_id?: string | null
          gold_earned: number
          input_expected_revision: number
          item_kind: string
          item_name: string
          legacy_card_id?: string | null
          patron_key: string
          quality_index: number
          relationship_change: number
          result: Json
          rules_version: string
          save_id: string
          turn_id?: string | null
        }
        Update: {
          action_id?: string
          actor_id?: string
          beverage_id?: string | null
          committed_revision?: number
          created_at?: string
          day_number?: number
          food_id?: string | null
          gold_earned?: number
          input_expected_revision?: number
          item_kind?: string
          item_name?: string
          legacy_card_id?: string | null
          patron_key?: string
          quality_index?: number
          relationship_change?: number
          result?: Json
          rules_version?: string
          save_id?: string
          turn_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hospitality_events_patron_key_fkey"
            columns: ["patron_key"]
            isOneToOne: false
            referencedRelation: "patron_catalog"
            referencedColumns: ["patron_key"]
          },
          {
            foreignKeyName: "hospitality_events_save_id_actor_id_fkey"
            columns: ["save_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "hospitality_events_save_id_beverage_id_fkey"
            columns: ["save_id", "beverage_id"]
            isOneToOne: false
            referencedRelation: "beverages"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "hospitality_events_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hospitality_events_save_id_food_id_fkey"
            columns: ["save_id", "food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "hospitality_events_save_id_legacy_card_id_fkey"
            columns: ["save_id", "legacy_card_id"]
            isOneToOne: false
            referencedRelation: "social_cards"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "hospitality_events_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "dialogue_turns"
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
      intent_card_plays: {
        Row: {
          actor_id: string
          card_id: string
          card_key: string
          catalog_version: string
          created_at: string
          day_number: number
          intent_snapshot: Json
          patron_key: string
          save_id: string
          tier: string
          turn_id: string
        }
        Insert: {
          actor_id: string
          card_id: string
          card_key: string
          catalog_version: string
          created_at?: string
          day_number: number
          intent_snapshot: Json
          patron_key: string
          save_id: string
          tier: string
          turn_id: string
        }
        Update: {
          actor_id?: string
          card_id?: string
          card_key?: string
          catalog_version?: string
          created_at?: string
          day_number?: number
          intent_snapshot?: Json
          patron_key?: string
          save_id?: string
          tier?: string
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intent_card_plays_card_key_catalog_version_fkey"
            columns: ["card_key", "catalog_version"]
            isOneToOne: false
            referencedRelation: "intent_card_catalog"
            referencedColumns: ["card_key", "version"]
          },
          {
            foreignKeyName: "intent_card_plays_patron_key_fkey"
            columns: ["patron_key"]
            isOneToOne: false
            referencedRelation: "patron_catalog"
            referencedColumns: ["patron_key"]
          },
          {
            foreignKeyName: "intent_card_plays_save_id_actor_id_fkey"
            columns: ["save_id", "actor_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "intent_card_plays_save_id_card_id_fkey"
            columns: ["save_id", "card_id"]
            isOneToOne: true
            referencedRelation: "intent_cards"
            referencedColumns: ["save_id", "id"]
          },
          {
            foreignKeyName: "intent_card_plays_save_id_fkey"
            columns: ["save_id"]
            isOneToOne: false
            referencedRelation: "tavern_saves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intent_card_plays_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "dialogue_turns"
            referencedColumns: ["id"]
          },
        ]
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
        }
        Insert: {
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
        }
        Update: {
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
      dialogue_begin: {
        Args: {
          p_actor: string
          p_intent_card?: string
          p_message: string
          p_offering_item?: string
          p_offering_kind?: string
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
      project_garden_day: { Args: never; Returns: Json }
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
      serve_hospitality: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_item_id: string
          p_item_kind: string
          p_legacy_card_id?: string
          p_patron_key: string
          p_save_id: string
        }
        Returns: Json
      }
      start_bake: {
        Args: {
          p_action_id: string
          p_expected_revision: number
          p_ingredient_batch_id: string
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

