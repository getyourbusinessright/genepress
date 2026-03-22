-- Add classification_complete and classification_review_required to the status CHECK constraint.
-- Also adds slot_definitions and unresolved_slots JSONB columns to genepress_components.

ALTER TABLE genepress_components
  DROP CONSTRAINT IF EXISTS genepress_components_status_check;

ALTER TABLE genepress_components
  ADD CONSTRAINT genepress_components_status_check
  CHECK (status IN (
    'intake_received',
    'sanitization_failed',
    'sanitization_passed',
    'parse_failed',
    'classification_in_progress',
    'classification_complete',
    'classification_review_required',
    'spec_generated',
    'compile_failed',
    'verified',
    'rejected',
    'certified',
    'needs_reverification',
    'update_in_progress',
    'superseded',
    'deprecated',
    'incompatible'
  ));

ALTER TABLE genepress_components
  ADD COLUMN IF NOT EXISTS slot_definitions JSONB,
  ADD COLUMN IF NOT EXISTS unresolved_slots JSONB;
