import * as Sentry from "@sentry/react";
import { db, supabase } from "./supabase";
import type { Json } from "../types/database";

/**
 * Writes a row to genepress_activity_log.
 *
 * Every pipeline action (compile, verify, publish, etc.) must call this so
 * there is a complete audit trail in Supabase. Write failures are captured
 * by Sentry but do NOT throw — a logging failure must never block the action
 * that triggered it.
 *
 * @param actionType  - What happened, e.g. 'auth_test', 'compile', 'publish'
 * @param componentId - genepress_component_sources.id (null for non-component actions)
 * @param beforeState - Snapshot of state before the action (null if not applicable)
 * @param afterState  - Snapshot of state after the action (null if not applicable)
 */
export async function logActivity(
  actionType: string,
  componentId: string | null,
  beforeState: Json,
  afterState: Json,
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await db
      .from("genepress_activity_log")
      .insert({
        action_type: actionType,
        component_id: componentId,
        before_state: beforeState,
        after_state: afterState,
        actor: user?.id ?? null,
      });

    if (error) {
      throw error;
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { context: "activity_log" },
      extra: { actionType, componentId },
    });
  }
}
