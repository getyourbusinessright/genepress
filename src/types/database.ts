export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      genepress_component_sources: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          name: string;
          source_type: string;
          raw_source: Json;
          status: string;
          error_message: string | null;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name: string;
          source_type: string;
          raw_source: Json;
          status?: string;
          error_message?: string | null;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name?: string;
          source_type?: string;
          raw_source?: Json;
          status?: string;
          error_message?: string | null;
          created_by?: string | null;
        };
        Relationships: [];
      };
      genepress_source_specs: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          source_id: string;
          spec_version: number;
          spec_data: Json;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          source_id: string;
          spec_version: number;
          spec_data: Json;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          source_id?: string;
          spec_version?: number;
          spec_data?: Json;
          is_active?: boolean;
        };
        Relationships: [];
      };
      genepress_compiled_variants: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          spec_id: string;
          source_id: string;
          variant_key: string;
          compiled_data: Json;
          compile_status: string;
          error_message: string | null;
          compiled_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          spec_id: string;
          source_id: string;
          variant_key: string;
          compiled_data: Json;
          compile_status?: string;
          error_message?: string | null;
          compiled_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          spec_id?: string;
          source_id?: string;
          variant_key?: string;
          compiled_data?: Json;
          compile_status?: string;
          error_message?: string | null;
          compiled_at?: string | null;
        };
        Relationships: [];
      };
      genepress_verification_runs: {
        Row: {
          id: string;
          created_at: string;
          variant_id: string;
          source_id: string;
          run_status: string;
          checks_passed: number;
          checks_failed: number;
          details: Json | null;
          verified_at: string | null;
          verified_by: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          variant_id: string;
          source_id: string;
          run_status?: string;
          checks_passed?: number;
          checks_failed?: number;
          details?: Json | null;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          variant_id?: string;
          source_id?: string;
          run_status?: string;
          checks_passed?: number;
          checks_failed?: number;
          details?: Json | null;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Relationships: [];
      };
      genepress_slot_maps: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          source_id: string;
          slot_key: string;
          target_field: string;
          transform: Json | null;
          is_required: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          source_id: string;
          slot_key: string;
          target_field: string;
          transform?: Json | null;
          is_required?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          source_id?: string;
          slot_key?: string;
          target_field?: string;
          transform?: Json | null;
          is_required?: boolean;
        };
        Relationships: [];
      };
      genepress_activity_log: {
        Row: {
          id: string;
          created_at: string;
          action_type: string;
          component_id: string | null;
          before_state: Json | null;
          after_state: Json | null;
          actor: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          action_type: string;
          component_id?: string | null;
          before_state?: Json | null;
          after_state?: Json | null;
          actor?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          action_type?: string;
          component_id?: string | null;
          before_state?: Json | null;
          after_state?: Json | null;
          actor?: string | null;
        };
        Relationships: [];
      };
      components_elementor: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          name: string;
          slug: string;
          elementor_json: Json;
          status: string;
          source_variant_id: string | null;
          published_at: string | null;
          published_by: string | null;
          meta: Json | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name: string;
          slug: string;
          elementor_json: Json;
          status?: string;
          source_variant_id?: string | null;
          published_at?: string | null;
          published_by?: string | null;
          meta?: Json | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name?: string;
          slug?: string;
          elementor_json?: Json;
          status?: string;
          source_variant_id?: string | null;
          published_at?: string | null;
          published_by?: string | null;
          meta?: Json | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
