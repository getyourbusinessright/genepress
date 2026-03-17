import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";

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

  // Parse request body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const {
    source_type,
    component_name,
    category,
    json_content,
    rights_status,
    acquisition_method,
  } = body as {
    source_type?: string;
    component_name?: string;
    category?: string;
    json_content?: unknown;
    rights_status?: string;
    acquisition_method?: string;
  };

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

  if (
    !json_content ||
    typeof json_content !== "object" ||
    Array.isArray(json_content)
  ) {
    return badRequest("json_content must be a valid object");
  }

  if (
    !Array.isArray(
      (json_content as Record<string, unknown>).content,
    )
  ) {
    return badRequest(
      "json_content must have a content array at the root",
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

  // --- MD5 checksum via Deno std crypto (extends WebCrypto with MD5 support) ---
  const jsonString = JSON.stringify(json_content);
  const msgBuffer = new TextEncoder().encode(jsonString);
  const hashBuffer = await crypto.subtle.digest("MD5", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const source_checksum = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // --- Insert into genepress_component_sources ---
  const { data: insertedSource, error: insertError } = await supabase
    .from("genepress_component_sources")
    .insert({
      component_id,
      source_type: "elementor_json",
      source_reference: component_name,
      source_checksum,
      sanitization_result: null,
      raw_source_artifact_location: null,
      source_ingestion_date: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    console.error("Insert failed:", insertError.message);
    return jsonResponse(
      { error: "Failed to insert component source", details: insertError.message },
      500,
    );
  }

  // --- Log to genepress_activity_log ---
  const { error: logError } = await supabase
    .from("genepress_activity_log")
    .insert({
      action_type: "intake_created",
      component_id,
      before_state: null,
      after_state: {
        source_type: "elementor_json",
        category,
        component_name,
        rights_status,
      },
    });

  if (logError) {
    // Log the error but don't fail the request — logging must not block the pipeline
    console.error("Activity log write failed:", logError.message);
  }

  // --- Success response ---
  return jsonResponse(
    {
      success: true,
      component_id,
      source_id: insertedSource.id,
      message: "Component intake record created. Ready for sanitization.",
    },
    200,
  );
});
