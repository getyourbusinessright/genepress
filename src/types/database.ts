export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ---------------------------------------------------------------------------
// genepress_component_sources
// The raw source definitions that feed the GenePress pipeline.
// ---------------------------------------------------------------------------
export interface GenepressComponentSource {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  source_type: string; // e.g. 'elementor_json', 'html', 'figma'
  raw_source: Json;
  status: "pending" | "processing" | "ready" | "error";
  error_message: string | null;
  created_by: string | null; // auth.users UUID
}

// ---------------------------------------------------------------------------
// genepress_source_specs
// Normalised specifications extracted from a component source.
// ---------------------------------------------------------------------------
export interface GenepressSourceSpec {
  id: string;
  created_at: string;
  updated_at: string;
  source_id: string; // FK → genepress_component_sources.id
  spec_version: number;
  spec_data: Json;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// genepress_compiled_variants
// Compiled output variants produced from a source spec.
// ---------------------------------------------------------------------------
export interface GenepressCompiledVariant {
  id: string;
  created_at: string;
  updated_at: string;
  spec_id: string; // FK → genepress_source_specs.id
  source_id: string; // FK → genepress_component_sources.id
  variant_key: string; // e.g. 'default', 'dark', 'mobile'
  compiled_data: Json;
  compile_status: "pending" | "success" | "error";
  error_message: string | null;
  compiled_at: string | null;
}

// ---------------------------------------------------------------------------
// genepress_verification_runs
// QA / verification pass results for a compiled variant.
// ---------------------------------------------------------------------------
export interface GenepressVerificationRun {
  id: string;
  created_at: string;
  variant_id: string; // FK → genepress_compiled_variants.id
  source_id: string; // FK → genepress_component_sources.id
  run_status: "pending" | "passed" | "failed" | "skipped";
  checks_passed: number;
  checks_failed: number;
  details: Json | null;
  verified_at: string | null;
  verified_by: string | null; // auth.users UUID or 'system'
}

// ---------------------------------------------------------------------------
// genepress_slot_maps
// Slot mapping definitions — maps named slots in a spec to output positions.
// ---------------------------------------------------------------------------
export interface GenepressSlotMap {
  id: string;
  created_at: string;
  updated_at: string;
  source_id: string; // FK → genepress_component_sources.id
  slot_key: string;
  target_field: string;
  transform: Json | null; // optional transform instructions
  is_required: boolean;
}

// ---------------------------------------------------------------------------
// genepress_activity_log
// Immutable audit log of every pipeline action.
// ---------------------------------------------------------------------------
export interface GenepressActivityLog {
  id: string;
  created_at: string;
  action_type: string; // e.g. 'auth_test', 'compile', 'verify', 'publish'
  component_id: string | null; // FK → genepress_component_sources.id (nullable)
  before_state: Json | null;
  after_state: Json | null;
  actor: string | null; // auth.users UUID
}

// ---------------------------------------------------------------------------
// components_elementor
// Shared handoff table GenePress writes final components to.
// Read by ConvertPress OS and other consumers.
// ---------------------------------------------------------------------------
export interface ComponentElementor {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  slug: string;
  elementor_json: Json;
  status: "draft" | "published" | "archived";
  source_variant_id: string | null; // FK → genepress_compiled_variants.id
  published_at: string | null;
  published_by: string | null; // auth.users UUID
  meta: Json | null;
}

// ---------------------------------------------------------------------------
// Supabase Database shape (passed to createClient<Database>)
// ---------------------------------------------------------------------------
export interface Database {
  public: {
    Tables: {
      genepress_component_sources: {
        Row: GenepressComponentSource;
        Insert: Omit<GenepressComponentSource, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<GenepressComponentSource, "id" | "created_at">>;
      };
      genepress_source_specs: {
        Row: GenepressSourceSpec;
        Insert: Omit<GenepressSourceSpec, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<GenepressSourceSpec, "id" | "created_at">>;
      };
      genepress_compiled_variants: {
        Row: GenepressCompiledVariant;
        Insert: Omit<GenepressCompiledVariant, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<GenepressCompiledVariant, "id" | "created_at">>;
      };
      genepress_verification_runs: {
        Row: GenepressVerificationRun;
        Insert: Omit<GenepressVerificationRun, "id" | "created_at">;
        Update: Partial<Omit<GenepressVerificationRun, "id" | "created_at">>;
      };
      genepress_slot_maps: {
        Row: GenepressSlotMap;
        Insert: Omit<GenepressSlotMap, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<GenepressSlotMap, "id" | "created_at">>;
      };
      genepress_activity_log: {
        Row: GenepressActivityLog;
        Insert: Omit<GenepressActivityLog, "id" | "created_at">;
        Update: never; // activity log is immutable
      };
      components_elementor: {
        Row: ComponentElementor;
        Insert: Omit<ComponentElementor, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<ComponentElementor, "id" | "created_at">>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
