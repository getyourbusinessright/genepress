/**
 * Phase 1B gate test — Elementor adapter isolation test
 *
 * Tests compile() and validate() in complete isolation (no sandbox, no UI).
 * Uses the real Supabase client to query genepress_source_specs and write
 * compiled variants.
 *
 * Env required (loaded via --env-file=.env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Tasks performed:
 *   1. Query genepress_source_specs for CTA 538 — log full row
 *   2. Run compile() directly — log full CompiledVariant
 *   3. Run validate() on the compiled output — log all 7 ExportSafetyFlags
 *   4. Structural check against V3 Flex golden export format
 *   5. Report results
 */

import { createClient } from "@supabase/supabase-js";
import {
  createElementorAdapter,
} from "../adapters/elementor/elementor_adapter_v1.0.0.js";

import type {
  SourceSpec,
  CompiledVariant,
  ExportSafetyFlags,
} from "../adapters/elementor/elementor_adapter_v1.0.0.js";

// ─── Supabase client ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
  process.exit(1);
}

// Note key format for the record
const keyType = SUPABASE_KEY.startsWith("sb_publishable_")
  ? "anon/publishable (sb_publishable_*) — NOTE: service role key expected; RLS may block writes"
  : SUPABASE_KEY.startsWith("sb_secret_")
  ? "service_role (sb_secret_*)"
  : SUPABASE_KEY.startsWith("eyJ")
  ? "service_role JWT (eyJ*)"
  : "unknown format";

console.log(`Key type detected: ${keyType}\n`);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CTA 538 fallback fixture ─────────────────────────────────────────────────
//
// Used only if the DB query returns no matching row.

const CTA_538_FIXTURE: SourceSpec = {
  spec_id: "spec_cta_538_v1",
  component_id: "cta_538",
  source_id: null,
  spec_schema_version: "source_spec_schema_v1",
  spec_origin: "manual",
  display_name: "CTA 538",
  validation_result: "passed",
  source_checksum: null,
  parser_version: null,
  slot_definitions: [
    {
      slot_id: "slot_headline",
      slot_type: "singleton",
      semantic_type: "text_headline",
      required: true,
      parent_container: "container_text_col",
      constraints: { max_chars: 120 },
      notes: "Primary headline for the CTA block",
    },
    {
      slot_id: "slot_body",
      slot_type: "singleton",
      semantic_type: "text_body",
      required: false,
      parent_container: "container_text_col",
      constraints: { max_chars: 400 },
      notes: "Supporting body copy",
    },
    {
      slot_id: "slot_cta_button",
      slot_type: "singleton",
      semantic_type: "cta",
      required: true,
      parent_container: "container_text_col",
      constraints: { max_chars: 60 },
      notes: "Primary call-to-action button",
    },
  ],
  structural_rules: [
    {
      container_id: "container_root",
      role: "section",
      slot_ref: null,
      flex_direction: "row",
      padding: { top: "60", right: "40", bottom: "60", left: "40" },
      background: { type: "classic", color: "" },
      children: ["container_text_col"],
    },
    {
      container_id: "container_text_col",
      role: "content",
      slot_ref: null,
      flex_direction: "column",
      padding: { top: "0", right: "0", bottom: "0", left: "0" },
      background: null,
      children: ["node_headline", "node_body", "node_cta"],
    },
    {
      container_id: "node_headline",
      role: "slot",
      slot_ref: "slot_headline",
      flex_direction: null,
      padding: null,
      background: null,
      children: [],
    },
    {
      container_id: "node_body",
      role: "slot",
      slot_ref: "slot_body",
      flex_direction: null,
      padding: null,
      background: null,
      children: [],
    },
    {
      container_id: "node_cta",
      role: "slot",
      slot_ref: "slot_cta_button",
      flex_direction: null,
      padding: null,
      background: null,
      children: [],
    },
  ],
};

// ─── Golden structure checker ─────────────────────────────────────────────────

type Discrepancy = { path: string; expected: string; actual: string };

function checkGoldenStructure(compiledJson: Record<string, unknown>): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  const requiredTopLevel = ["title", "type", "version", "page_settings", "content"];
  for (const key of requiredTopLevel) {
    if (!(key in compiledJson)) {
      discrepancies.push({ path: `[root].${key}`, expected: "present", actual: "missing" });
    }
  }

  if (compiledJson["version"] !== "0.4") {
    discrepancies.push({
      path: "[root].version",
      expected: '"0.4"',
      actual: JSON.stringify(compiledJson["version"]),
    });
  }

  const content = compiledJson["content"];
  if (!Array.isArray(content)) {
    discrepancies.push({ path: "[root].content", expected: "array", actual: typeof content });
    return discrepancies;
  }

  const PRO_PREFIXES = [
    "pro-", "woocommerce", "lottie", "form", "hotspot",
    "pro-gallery", "nav-menu", "share-buttons", "paypal-button", "stripe-button",
  ];
  const EXTERNAL_SCRIPT_RE = /<script|javascript:/i;

  function checkElement(el: unknown, path: string): void {
    if (typeof el !== "object" || el === null) {
      discrepancies.push({ path, expected: "object", actual: String(el) });
      return;
    }
    const node = el as Record<string, unknown>;

    for (const key of ["id", "elType", "isInner", "settings", "elements"]) {
      if (!(key in node)) {
        discrepancies.push({ path: `${path}.${key}`, expected: "present", actual: "missing" });
      }
    }

    const elType = node["elType"];
    if (elType !== "container" && elType !== "widget") {
      discrepancies.push({
        path: `${path}.elType`,
        expected: '"container" | "widget"',
        actual: JSON.stringify(elType),
      });
    }

    if (node["isInner"] !== false) {
      discrepancies.push({
        path: `${path}.isInner`,
        expected: "false",
        actual: JSON.stringify(node["isInner"]),
      });
    }

    if (elType === "widget") {
      if (!("widgetType" in node)) {
        discrepancies.push({ path: `${path}.widgetType`, expected: "present", actual: "missing" });
      }
      const widgetType = typeof node["widgetType"] === "string" ? node["widgetType"] : "";
      for (const prefix of PRO_PREFIXES) {
        if (widgetType.startsWith(prefix)) {
          discrepancies.push({
            path: `${path}.widgetType`,
            expected: "no Pro widget type",
            actual: widgetType,
          });
        }
      }
      if (EXTERNAL_SCRIPT_RE.test(JSON.stringify(node["settings"] ?? {}))) {
        discrepancies.push({
          path: `${path}.settings`,
          expected: "no external script references",
          actual: "contains <script or javascript:",
        });
      }
      const elems = node["elements"];
      if (!Array.isArray(elems) || elems.length !== 0) {
        discrepancies.push({
          path: `${path}.elements`,
          expected: "[]",
          actual: JSON.stringify(elems),
        });
      }
    }

    if (elType === "container") {
      if (Array.isArray(node["elements"])) {
        (node["elements"] as unknown[]).forEach((child, i) =>
          checkElement(child, `${path}.elements[${i}]`),
        );
      }
    }

    // No atomic_form role leaking through
    if (node["role"] === "atomic_form") {
      discrepancies.push({
        path: `${path}.role`,
        expected: "no atomic_form role",
        actual: "atomic_form",
      });
    }
  }

  content.forEach((node, i) => {
    const path = `content[${i}]`;
    checkElement(node, path);
    const el = node as Record<string, unknown>;
    if (el["elType"] !== "container") {
      discrepancies.push({
        path: `${path}.elType`,
        expected: '"container" (top-level must be container)',
        actual: JSON.stringify(el["elType"]),
      });
    }
  });

  return discrepancies;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ELEMENTOR ADAPTER ISOLATION TEST — Phase 1B Gate");
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── TASK 1: Query genepress_source_specs for CTA 538 ────────────────────────
  console.log("─── TASK 1: genepress_source_specs — CTA 538 ────────────────");

  // Try multiple likely component_id / spec_id patterns for CTA 538
  const { data: rows, error: queryError } = await supabase
    .from("genepress_source_specs")
    .select("*")
    .or("component_id.ilike.%cta%538%,component_id.ilike.%538%,spec_id.ilike.%cta%538%,spec_id.ilike.%538%");

  let sourceSpec: SourceSpec;
  let specSource: "live_db" | "fixture";

  if (queryError) {
    console.log(`DB query error: ${queryError.message}`);
    console.log("  → falling back to constructed fixture\n");
    sourceSpec = CTA_538_FIXTURE;
    specSource = "fixture";
  } else if (!rows || rows.length === 0) {
    console.log("DB query returned 0 rows matching CTA 538 patterns.");
    console.log("  Patterns tried: component_id or spec_id containing '538' or 'cta%538'");

    // Broader fallback: show all spec_ids so we can see what's there
    const { data: allSpecs, error: allErr } = await supabase
      .from("genepress_source_specs")
      .select("spec_id, component_id, spec_schema_version, spec_origin")
      .limit(20);

    if (!allErr && allSpecs && allSpecs.length > 0) {
      console.log(`\n  All specs in table (up to 20):`);
      allSpecs.forEach(r => console.log(`    spec_id=${r.spec_id}  component_id=${r.component_id}`));
    } else if (!allErr && (!allSpecs || allSpecs.length === 0)) {
      console.log("  Table appears to be empty.");
    } else {
      console.log(`  Could not list all specs: ${allErr?.message}`);
    }

    console.log("\n  → falling back to constructed fixture\n");
    sourceSpec = CTA_538_FIXTURE;
    specSource = "fixture";
  } else {
    // Use first matching row
    const row = rows[0];
    console.log(`Found ${rows.length} matching row(s). Using first:\n`);
    console.log(JSON.stringify(row, null, 2));

    sourceSpec = {
      spec_id: row.spec_id,
      component_id: row.component_id,
      source_id: row.source_id ?? null,
      spec_schema_version: row.spec_schema_version,
      spec_origin: row.spec_origin,
      validation_result: row.validation_result ?? null,
      source_checksum: row.source_checksum ?? null,
      parser_version: row.parser_version ?? null,
      slot_definitions: Array.isArray(row.slot_definitions)
        ? row.slot_definitions as SourceSpec["slot_definitions"]
        : [],
      structural_rules: Array.isArray(row.structural_rules)
        ? row.structural_rules as SourceSpec["structural_rules"]
        : [],
    };
    specSource = "live_db";
  }

  console.log(`\nSpec source: ${specSource}\n`);

  // ── TASK 2: compile() ────────────────────────────────────────────────────────
  console.log("─── TASK 2: compile() ───────────────────────────────────────");
  const adapter = createElementorAdapter(supabase);
  let compiled: CompiledVariant;

  try {
    compiled = await adapter.compile(sourceSpec);
    console.log("compile() returned successfully.\n");
    console.log("Full CompiledVariant output:");
    console.log(JSON.stringify(compiled, null, 2));
    console.log();
  } catch (err) {
    console.error("compile() THREW an error:", err);
    process.exit(1);
  }

  // ── TASK 3: validate() ───────────────────────────────────────────────────────
  console.log("─── TASK 3: validate() — ExportSafetyFlags ──────────────────");
  const flags: ExportSafetyFlags = adapter.validate(compiled.compiled_json);
  console.log("ExportSafetyFlags result:");
  console.log(JSON.stringify(flags, null, 2));

  const failingFlags = Object.entries(flags).filter(([, v]) => v);
  if (failingFlags.length === 0) {
    console.log("\n✓ ALL 7 flags are false — export safety check PASSED.");
  } else {
    console.log(`\n✗ ${failingFlags.length} flag(s) TRUE — export safety check FAILED:`);
    for (const [flag] of failingFlags) {
      console.log(`  - ${flag}: true`);
    }
  }
  console.log();

  // ── TASK 4: Structural check ─────────────────────────────────────────────────
  console.log("─── TASK 4: Structural check vs V3 Flex golden format ───────");
  const discrepancies = checkGoldenStructure(compiled.compiled_json as Record<string, unknown>);

  if (discrepancies.length === 0) {
    console.log("✓ No structural discrepancies — matches V3 Flex golden format.");
  } else {
    console.log(`✗ ${discrepancies.length} structural discrepancy/discrepancies found:`);
    for (const d of discrepancies) {
      console.log(`  PATH:     ${d.path}`);
      console.log(`  EXPECTED: ${d.expected}`);
      console.log(`  ACTUAL:   ${d.actual}\n`);
    }
  }
  console.log();

  // ── TASK 5: DB write verification ────────────────────────────────────────────
  console.log("─── TASK 5: DB write verification ───────────────────────────");

  // Re-query genepress_compiled_variants for the variant we just wrote
  const variantId = compiled.variant_id;
  const { data: variantRow, error: variantErr } = await supabase
    .from("genepress_compiled_variants")
    .select("id, compile_status, adapter_version, export_safety_flags, fixture_suite_version")
    .eq("id", variantId)
    .single();

  if (variantErr) {
    console.log(`  genepress_compiled_variants read-back: ERROR — ${variantErr.message}`);
    console.log("  compile_status written: UNKNOWN (read-back failed)");
  } else if (!variantRow) {
    console.log("  genepress_compiled_variants read-back: row not found");
    console.log("  compile_status written: UNKNOWN");
  } else {
    console.log("  genepress_compiled_variants row read back successfully:");
    console.log(JSON.stringify(variantRow, null, 4).split("\n").map(l => "  " + l).join("\n"));
    const statusOk = variantRow.compile_status === "success";
    console.log(`\n  compile_status = "${variantRow.compile_status}" — ${statusOk ? "✓ correct" : "✗ WRONG"}`);
  }

  // Re-query activity log for the most recent compile_succeeded entry for this component
  const { data: logRows, error: logErr } = await supabase
    .from("genepress_activity_log")
    .select("action_type, after_state, created_at")
    .eq("component_id", sourceSpec.component_id)
    .eq("action_type", "compile_succeeded")
    .order("created_at", { ascending: false })
    .limit(1);

  if (logErr) {
    console.log(`\n  genepress_activity_log read-back: ERROR — ${logErr.message}`);
  } else if (!logRows || logRows.length === 0) {
    console.log("\n  genepress_activity_log: no compile_succeeded entry found for this component");
  } else {
    const logRow = logRows[0];
    const afterState = logRow.after_state as Record<string, unknown> | null;
    const ssv = afterState?.["spec_schema_version"];
    console.log("\n  activity log compile_succeeded entry:");
    console.log(JSON.stringify(logRow, null, 4).split("\n").map(l => "  " + l).join("\n"));
    console.log(`\n  spec_schema_version in after_state = "${ssv}" — ${ssv === "source_spec_schema_v1" ? "✓ correct" : "✗ WRONG or missing"}`);
  }
  console.log();

  // ── SUMMARY ──────────────────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Spec source     : ${specSource}`);
  console.log(`  Key type        : ${keyType}`);
  console.log(`  compile()       : ${compiled.compile_status === "success" ? "✓ success" : "✗ failed"}`);
  console.log(`  compile_warnings: ${compiled.compile_warnings.length === 0 ? "none" : compiled.compile_warnings.join(", ")}`);
  console.log(`  ExportSafetyFlags: ${failingFlags.length === 0 ? "ALL CLEAR (7/7 false)" : `${failingFlags.length} FLAG(S) RAISED`}`);
  console.log(`  Golden structure: ${discrepancies.length === 0 ? "MATCHES" : `${discrepancies.length} DISCREPANCY/DISCREPANCIES`}`);
  console.log();

  const gatePass =
    compiled.compile_status === "success" &&
    failingFlags.length === 0 &&
    discrepancies.length === 0;
  console.log(`  GATE RESULT: ${gatePass ? "✓ PASS — ready to proceed to Phase 1C" : "✗ FAIL — see above"}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  process.exit(gatePass ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
