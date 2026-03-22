-- GP-1A-05: Create genepress_source_specs with the canonical source_spec_schema_v1 definition.
-- Drops the old placeholder table (different PK / column shape) and recreates it correctly.

DROP TABLE IF EXISTS genepress_source_specs CASCADE;

CREATE TABLE IF NOT EXISTS genepress_source_specs (

  spec_id                varchar     PRIMARY KEY,
    -- Format: spec_{component_id}_v{n}
    -- e.g.   spec_cmp_hero_trust_split_001_v1

  component_id           varchar     NOT NULL
    REFERENCES genepress_components(component_id),

  source_id              uuid
    REFERENCES genepress_component_sources(source_id),
    -- NULL for manually-authored specs (Mode 4 / spec_origin = 'manual')

  spec_schema_version    text        NOT NULL,
    -- e.g. source_spec_schema_v1

  spec_origin            text        NOT NULL
    CHECK (spec_origin IN (
      'intake', 'manual', 'generated', 'composed', 'built'
    )),
  -- 'intake'    → pipeline-ingested from Figma or Elementor JSON
  -- 'manual'    → authored directly in GeneSpec format (Mode 4)
  -- 'generated' → produced via variant generation (Mode 2)
  -- 'composed'  → assembled from multiple existing specs (Mode 3)
  -- 'built'     → built from scratch via Mode 5 recompile

  slot_definitions       jsonb       NOT NULL DEFAULT '{}',
  -- Full slot map with types, constraints, position metadata.

  structural_rules       jsonb       NOT NULL DEFAULT '{}',
  -- Layout tree: container_id, role, slot_ref, flex_direction,
  -- padding, background, children, and all layout properties.

  validation_result      text
    CHECK (validation_result IN ('passed', 'failed', 'warnings')),

  source_checksum        text,
    -- NULL for manually authored specs

  parser_version         text,
    -- NULL for manually authored specs

  operator_id            text,
    -- ID of operator who authored spec manually.
    -- NULL for pipeline-generated specs.

  sanitization_status    text        NOT NULL DEFAULT 'not_run'
    CHECK (sanitization_status IN ('not_run', 'passed', 'failed')),
    -- 'not_run' for manually authored specs (Mode 4)

  ingestion_date         timestamptz,
    -- NULL for manually authored specs

  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gss_component_id
  ON genepress_source_specs(component_id);
