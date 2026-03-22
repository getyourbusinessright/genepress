// Task 3 — AI Classification Pass (Checkpoint 3b — conditional)
// Only fires for regions that the heuristic pass left unclassified (confidence === 'low').
// AI is advisory only — confidence is capped at 'medium', never 'high'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ClassifiedRegion, SlotType } from "./classify-heuristic.ts";

type SupabaseClient = ReturnType<typeof createClient>;

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

const VALID_SLOT_TYPES: SlotType[] = [
  "text_headline",
  "text_body",
  "cta",
  "image",
  "list",
];

// ─── Sentry reporting (lightweight, no SDK required in Deno) ──────────────────

async function reportToSentry(data: {
  component_id: string;
  checkpoint: string;
  error_class: string;
  error_detail: string;
}): Promise<void> {
  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn) {
    console.error(
      "[Sentry] No DSN configured — logging locally:",
      JSON.stringify(data),
    );
    return;
  }

  try {
    const url = new URL(dsn);
    const key = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    const storeEndpoint = `https://${url.host}/api/${projectId}/store/`;

    await fetch(storeEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth":
          `Sentry sentry_version=7, sentry_client=genepress-edge/1.0, sentry_key=${key}`,
      },
      body: JSON.stringify({
        message: `[GP checkpoint ${data.checkpoint}] ${data.error_class}: ${data.error_detail}`,
        level: "error",
        tags: {
          component_id: data.component_id,
          checkpoint: data.checkpoint,
          error_class: data.error_class,
        },
        extra: data,
      }),
    });
  } catch (e) {
    console.error("[Sentry] Failed to deliver error report:", e);
  }
}

// ─── Single Anthropic API call for one region ─────────────────────────────────

async function classifyRegionWithAI(
  region: ClassifiedRegion,
  componentContext: string,
  apiKey: string,
): Promise<{ slot_type: SlotType | "unclassified"; tokens_used: number }> {
  const userPrompt =
    `Component context: ${componentContext}\nElement name: ${region.element_name ?? "unknown"}\nElement type: ${region.element_type ?? "unknown"}\nPosition in section: ${region.structural_position ?? "unknown"}\nWhat slot type is this?`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 10,
      system:
        "You are classifying content slots in a web component. A slot is one of: text_headline | text_body | cta | image | list. Return ONLY the slot type. No explanation. No punctuation.",
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Anthropic API error ${response.status}: ${await response.text()}`,
    );
  }

  const json = await response.json();
  const tokens_used: number = json.usage?.input_tokens + json.usage?.output_tokens ?? 0;
  const rawText: string = (json.content?.[0]?.text ?? "").trim().toLowerCase();

  const matched = VALID_SLOT_TYPES.find((s) => s === rawText);
  return { slot_type: matched ?? "unclassified", tokens_used };
}

// ─── Public export ────────────────────────────────────────────────────────────

export async function classifyWithAI(
  regions: ClassifiedRegion[],
  componentContext: string,
  component_id: string,
  supabase: SupabaseClient,
): Promise<ClassifiedRegion[]> {
  const lowConfidenceRegions = regions.filter((r) => r.confidence === "low");

  // Early exit — nothing to classify
  if (lowConfidenceRegions.length === 0) {
    return regions;
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error(
      "[classify-ai] ANTHROPIC_API_KEY not set — skipping AI pass",
    );
    return regions;
  }

  // Build a mutable map for efficient updates
  const regionMap = new Map<string, ClassifiedRegion>(
    regions.map((r) => [r.region_id, { ...r }]),
  );

  for (const region of lowConfidenceRegions) {
    try {
      const { slot_type, tokens_used } = await classifyRegionWithAI(
        region,
        componentContext,
        apiKey,
      );

      if (slot_type !== "unclassified") {
        regionMap.set(region.region_id, {
          ...region,
          slot_type,
          confidence: "medium", // AI is advisory — never elevated to high
        });
      }

      // Log token usage regardless of classification success
      const { error: logError } = await supabase.rpc("log_genepress_activity", {
        p_component_id: component_id,
        p_action_type: "slot_classification_ai",
        p_actor: "system",
        p_before_state: { slot_type: "unclassified", confidence: "low" },
        p_after_state: {
          tokens_used,
          slot_classified: region.element_name,
          result_slot_type: slot_type,
        },
      });

      if (logError) {
        console.error(
          "[classify-ai] Activity log write failed:",
          JSON.stringify(logError),
        );
      }
    } catch (e) {
      const errorDetail = e instanceof Error ? e.message : String(e);
      console.error(
        `[classify-ai] API call failed for region ${region.region_id}:`,
        errorDetail,
      );

      await reportToSentry({
        component_id,
        checkpoint: "3b",
        error_class: "parse_error",
        error_detail: errorDetail,
      });

      // Region stays unclassified, confidence stays 'low' — no update needed
    }
  }

  // Return regions in original order with updates applied
  return regions.map((r) => regionMap.get(r.region_id)!);
}
