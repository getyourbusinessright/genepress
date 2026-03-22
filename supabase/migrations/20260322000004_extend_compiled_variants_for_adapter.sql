-- GP-1B-01: Extend genepress_compiled_variants with adapter-layer columns.
-- Adds all fields required by the BuilderAdapter compile() contract.

ALTER TABLE genepress_compiled_variants

  -- Compiled Elementor JSON (the full page/section document produced by the adapter).
  -- compiled_data remains for backward-compat; compiled_json is the canonical adapter output.
  ADD COLUMN IF NOT EXISTS compiled_json          jsonb,

  -- Warnings emitted during compile (downgrade notices, stripped constructs, etc.).
  ADD COLUMN IF NOT EXISTS compile_warnings       jsonb        NOT NULL DEFAULT '[]',

  -- Whether this variant is the active/preferred variant for its spec.
  ADD COLUMN IF NOT EXISTS is_active              boolean      NOT NULL DEFAULT true,

  -- Snapshot of the adapter capability matrix at compile time.
  ADD COLUMN IF NOT EXISTS capability_profile     jsonb,

  -- Snapshot of the downgrade rule set applied during compile.
  ADD COLUMN IF NOT EXISTS downgrade_path         jsonb,

  -- Elementor Free semver that was targeted (e.g. "3.27.5").
  ADD COLUMN IF NOT EXISTS builder_version        text,

  -- Adapter semver identifier (e.g. "elementor_adapter_v1.0.0").
  ADD COLUMN IF NOT EXISTS adapter_version        text,

  -- Elementor editor mode used (e.g. "flex").
  ADD COLUMN IF NOT EXISTS target_editor_mode     text,

  -- Component this variant belongs to.
  ADD COLUMN IF NOT EXISTS component_id           varchar
    REFERENCES genepress_components(component_id),

  -- ExportSafetyFlags result from validate() — stored after the compile run.
  ADD COLUMN IF NOT EXISTS export_safety_flags    jsonb,

  -- Fixture suite version from sandbox/manifest.json (used for reproducibility).
  ADD COLUMN IF NOT EXISTS fixture_suite_version  text;

-- Index so we can quickly find all variants for a component.
CREATE INDEX IF NOT EXISTS idx_gcv_component_id
  ON genepress_compiled_variants(component_id);

-- Index for active-variant lookups per spec.
CREATE INDEX IF NOT EXISTS idx_gcv_spec_active
  ON genepress_compiled_variants(spec_id, is_active);
