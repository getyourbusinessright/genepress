import * as Sentry from "@sentry/react";
import { db, supabase } from "./supabase";
import type { Json, Database } from "../types/database";

type ActivityLogInsert = Database["public"]["Tables"]["genepress_activity_log"]["Insert"];

/**
 * Writes a row to genepress_activity_log.
 *
 * Every pipeline action (compile, verify, publish, etc.) must call this so
 * there is a complete audit trail in Supabase. Write failures are captured
 * by Sentry but do NOT throw — a logging failure must never block the action
 * that triggered it.
 */
export async function logActivity(
  actionType: string,
  componentId: string | null,
  beforeState: Json,
  afterState: Json,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();

  const row: ActivityLogInsert = {
    action_type: actionType,
    component_id: componentId,
    before_state: beforeState,
    after_state: afterState,
    actor: user?.id ?? null,
  };

  const { error } = await db
    .from("genepress_activity_log")
    .insert(row);

  if (error) {
    Sentry.captureException(error, {
      tags: { context: "activity_log" },
      extra: { actionType, componentId },
    });
    throw error;
  }
}
