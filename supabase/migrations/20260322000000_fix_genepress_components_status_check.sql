-- Fix genepress_components status CHECK constraint to include pipeline statuses.
-- The original constraint only covered end-states (certified, needs_reverification, etc.)
-- and rejected intake_received, sanitization_failed, sanitization_passed, etc.

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
