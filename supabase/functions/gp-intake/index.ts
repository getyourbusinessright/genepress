import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { sanitizeElementorJson } from "./sanitize.ts";
import { parseSource } from "./parse.ts";
import type { SanitizedPayload } from "./parse.ts";
import { classifyHeuristic } from "./classify-heuristic.ts";
import { classifyWithAI } from "./classify-ai.ts";
import { extractSlots } from "./slot-extractor.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VALID_CATEGORIES = [
  "hero",
  "services",
  "testimonials",
  "about",
  "cta",
  "footer",
] as const;

const VALID_RIGHTS_STATUSES = [
  "verified",
  "assumed",
  "disputed",
  "restricted",
] as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function badRequest(error: string): Response {
  return jsonResponse({ error }, 400);
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Parse multipart/form-data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return badRequest("Expected multipart/form-data");
  }

  const source_type = formData.get("source_type") as string | null;
  const component_name = formData.get("component_name") as string | null;
  const category = formData.get("category") as string | null;
  const rights_status = formData.get("rights_status") as string | null;
  const acquisition_method = formData.get("acquisition_method") as string | null;
  const json_file = formData.get("json_file") as File | null;

  // --- Validation ---

  // Figma stub
  if (source_type === "figma") {
    return jsonResponse(
      { error: "Figma intake is not yet implemented" },
      501,
    );
  }

  if (source_type !== "elementor_json") {
    return badRequest("source_type must be elementor_json");
  }

  if (!component_name || typeof component_name !== "string") {
    return badRequest("component_name is required");
  }

  if (!category || typeof category !== "string") {
    return badRequest("category is required");
  }

  if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
    return badRequest(
      `category must be one of: ${VALID_CATEGORIES.join(", ")}`,
    );
  }

  if (!rights_status || !(VALID_RIGHTS_STATUSES as readonly string[]).includes(rights_status)) {
    return badRequest(
      "rights_status must be one of: verified, assumed, disputed, restricted",
    );
  }

  if (!acquisition_method || typeof acquisition_method !== "string") {
    return badRequest("acquisition_method is required");
  }

  if (!json_file || !(json_file instanceof File)) {
    return badRequest("json_file is required");
  }

  // Parse and validate uploaded JSON file
  let json_content: Record<string, unknown>;
  let fileText: string;
  try {
    fileText = await json_file.text();
    const parsed = JSON.parse(fileText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return badRequest("invalid_json_file");
    }
    json_content = parsed as Record<string, unknown>;
  } catch {
    return badRequest("invalid_json_file");
  }

  if (!Array.isArray(json_content.content)) {
    return badRequest("json_content must have a content array at the root");
  }

  // --- Supabase client (service role — bypasses RLS) ---
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- Generate component_id ---
  const descriptor = component_name.trim().split(/\s+/)[0].toLowerCase();

  const { count, error: countError } = await supabase
    .from("genepress_component_sources")
    .select("*", { count: "exact", head: true })
    .like("component_id", `cmp_${category}_%`);

  if (countError) {
    console.error("Count query failed:", countError.message);
    return jsonResponse(
      { error: "Failed to count existing components", details: countError.message },
      500,
    );
  }

  const sequence = String((count ?? 0) + 1).padStart(3, "0");
  const component_id = `cmp_${category}_${descriptor}_${sequence}`;

  // --- MD5 checksum via Deno std crypto ---
  const jsonString = JSON.stringify(json_content);
  const msgBuffer = new TextEncoder().encode(jsonString);
  const hashBuffer = await crypto.subtle.digest("MD5", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const source_checksum = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // --- Upload raw file to Supabase Storage ---
  const storagePath = `${component_id}/${component_id}_source.json`;
  const fileBytes = new TextEncoder().encode(fileText);

  const { error: uploadError } = await supabase.storage
    .from("genepress-source-artifacts")
    .upload(storagePath, fileBytes, {
      contentType: "application/json",
      upsert: false,
    });

  if (uploadError) {
    console.error("Storage upload failed:", uploadError.message);
    return jsonResponse(
      { error: "storage_upload_failed", details: uploadError.message },
      500,
    );
  }

  const raw_source_artifact_location = storagePath;

  // --- Insert into genepress_components (parent row) ---
  const { error: componentInsertError } = await supabase
    .from("genepress_components")
    .insert({
      component_id,
      display_name: component_name,
      category,
      status: "intake_received",
      rights_status,
      acquisition_method,
      source_origin: "sections_express",
      marketplace_safe: false,
      internal_use_only: true,
      creator_attribution: null,
    });

  if (componentInsertError) {
    console.error("genepress_components insert failed:", componentInsertError.message);
    return jsonResponse(
      { error: "failed_to_create_component", details: componentInsertError.message },
      500,
    );
  }

  // --- Insert into genepress_component_sources ---
  const { data: insertedSource, error: insertError } = await supabase
    .from("genepress_component_sources")
    .insert({
      component_id,
      source_type: "elementor_json",
      source_reference: component_name,
      source_checksum,
      sanitization_result: null,
      raw_source_artifact_location,
      source_ingestion_date: new Date().toISOString(),
    })
    .select("source_id")
    .single();

  if (insertError) {
    console.error("Insert failed:", insertError.message);
    return jsonResponse(
      { error: "Failed to insert component source", details: insertError.message },
      500,
    );
  }

  // --- Log to genepress_activity_log ---
  const { error: logError } = await supabase.rpc("log_genepress_activity", {
    p_component_id: component_id,
    p_action_type: "intake_created",
    p_actor: "system",
    p_performed_by: null,
    p_before_state: null,
    p_after_state: {
      source_type: "elementor_json",
      category,
      component_name,
      rights_status,
    },
  });

  if (logError) {
    console.error("Activity log write failed [intake_created]:", JSON.stringify(logError));
  }

  // --- Sanitization ---
  const sanitization = sanitizeElementorJson(json_content);

  // Update genepress_component_sources with sanitization result
  await supabase
    .from("genepress_component_sources")
    .update({ sanitization_result: sanitization.result })
    .eq("source_id", insertedSource.source_id);

  // Update genepress_components status
  const newStatus = sanitization.result === "fail"
    ? "sanitization_failed"
    : "sanitization_passed";

  await supabase
    .from("genepress_components")
    .update({ status: newStatus })
    .eq("component_id", component_id);

  // Log sanitization result
  const { error: sanitizationLogError } = await supabase.rpc("log_genepress_activity", {
    p_component_id: component_id,
    p_action_type: "sanitization_complete",
    p_actor: "system",
    p_performed_by: null,
    p_before_state: { status: "intake_received" },
    p_after_state: {
      status: newStatus,
      sanitization_result: sanitization.result,
      failures: sanitization.failures,
      warnings: sanitization.warnings,
    },
  });

  if (sanitizationLogError) {
    console.error("Activity log write failed [sanitization_complete]:", JSON.stringify(sanitizationLogError));
  }

  // Hard stop on sanitization failure
  if (sanitization.result === "fail") {
    return jsonResponse({
      error: "sanitization_failed",
      failures: sanitization.failures,
    }, 422);
  }

  // ─── Classification pipeline ─────────────────────────────────────────────

  // Mark as classification_in_progress
  await supabase
    .from("genepress_components")
    .update({ status: "classification_in_progress" })
    .eq("component_id", component_id);

  // Step 1: Parse
  const sanitizedPayload: SanitizedPayload = {
    component_id,
    source_type: "elementor_json",
    json_content,
  };

  const parseResult = parseSource(sanitizedPayload);

  if (parseResult.parse_error) {
    await supabase
      .from("genepress_components")
      .update({ status: "parse_failed" })
      .eq("component_id", component_id);

    const { error: parseFailLogError } = await supabase.rpc(
      "log_genepress_activity",
      {
        p_component_id: component_id,
        p_action_type: "parse_failed",
        p_actor: "system",
        p_performed_by: null,
        p_before_state: { status: "classification_in_progress" },
        p_after_state: { parse_error: parseResult.parse_error },
      },
    );

    if (parseFailLogError) {
      console.error(
        "Activity log write failed [parse_failed]:",
        JSON.stringify(parseFailLogError),
      );
    }

    return jsonResponse(
      { error: "parse_failed", details: parseResult.parse_error },
      422,
    );
  }

  // Step 2: Heuristic classification (3a — deterministic, no AI)
  let classifiedRegions = classifyHeuristic(parseResult.raw_regions);

  // Step 3: AI classification pass (3b — conditional, only for low-confidence)
  const hasLowConfidence = classifiedRegions.some((r) => r.confidence === "low");
  if (hasLowConfidence) {
    classifiedRegions = await classifyWithAI(
      classifiedRegions,
      raw_source_artifact_location, // component context: storage path serves as identifier
      component_id,
      supabase,
    );
  }

  // Step 4: Slot extraction
  const slotResult = extractSlots(classifiedRegions);

  // Step 5a / 5b: Update status and store slot data
  const slotUpdatePayload = {
    slot_definitions: slotResult.slot_definitions,
    unresolved_slots: slotResult.has_unresolved
      ? slotResult.unresolved_regions
      : null,
  };

  if (!slotResult.has_unresolved) {
    // 5a: All slots resolved — classification complete
    await supabase
      .from("genepress_components")
      .update({ status: "classification_complete", ...slotUpdatePayload })
      .eq("component_id", component_id);

    const { error: classCompleteLogError } = await supabase.rpc(
      "log_genepress_activity",
      {
        p_component_id: component_id,
        p_action_type: "classification_complete",
        p_actor: "system",
        p_performed_by: null,
        p_before_state: { status: "classification_in_progress" },
        p_after_state: { slot_count: slotResult.slot_definitions.length },
      },
    );

    if (classCompleteLogError) {
      console.error(
        "Activity log write failed [classification_complete]:",
        JSON.stringify(classCompleteLogError),
      );
    }

    return jsonResponse(
      {
        success: true,
        component_id,
        source_id: insertedSource.source_id,
        raw_source_artifact_location,
        sanitization_result: sanitization.result,
        sanitization_warnings: sanitization.warnings,
        classification_status: "classification_complete",
        slot_count: slotResult.slot_definitions.length,
        message: "Component intake, sanitization, and classification complete.",
      },
      200,
    );
  } else {
    // 5b: Some slots remain unresolved — human review required (NOT an error, returns 200)
    await supabase
      .from("genepress_components")
      .update({
        status: "classification_review_required",
        ...slotUpdatePayload,
      })
      .eq("component_id", component_id);

    const { error: classReviewLogError } = await supabase.rpc(
      "log_genepress_activity",
      {
        p_component_id: component_id,
        p_action_type: "classification_review_required",
        p_actor: "system",
        p_performed_by: null,
        p_before_state: { status: "classification_in_progress" },
        p_after_state: {
          unresolved_count: slotResult.unresolved_regions.length,
        },
      },
    );

    if (classReviewLogError) {
      console.error(
        "Activity log write failed [classification_review_required]:",
        JSON.stringify(classReviewLogError),
      );
    }

    return jsonResponse(
      {
        success: true,
        component_id,
        source_id: insertedSource.source_id,
        raw_source_artifact_location,
        sanitization_result: sanitization.result,
        sanitization_warnings: sanitization.warnings,
        classification_status: "classification_review_required",
        slot_count: slotResult.slot_definitions.length,
        unresolved_count: slotResult.unresolved_regions.length,
        message:
          "Component intake and sanitization complete. Some slots require human review before classification is finalised.",
        requires_review: true,
      },
      200,
    );
  }
});
