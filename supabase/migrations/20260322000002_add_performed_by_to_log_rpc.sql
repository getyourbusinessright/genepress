-- Update log_genepress_activity to accept p_performed_by alongside p_actor.
-- p_performed_by is nullable (text DEFAULT NULL) so existing callers without the
-- param continue to work. All system calls pass NULL explicitly.
CREATE OR REPLACE FUNCTION public.log_genepress_activity(
  p_component_id  text,
  p_action_type   text,
  p_actor         text,
  p_before_state  jsonb,
  p_after_state   jsonb,
  p_performed_by  text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO genepress_activity_log (
    component_id,
    action_type,
    before_state,
    after_state,
    performed_by
  ) VALUES (
    p_component_id,
    p_action_type,
    p_before_state,
    p_after_state,
    COALESCE(p_performed_by, p_actor)
  );
$$;
