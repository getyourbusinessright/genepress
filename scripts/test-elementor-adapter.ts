/**
 * Phase 1B gate test — Elementor adapter isolation test
 *
 * Tests compile() and validate() in complete isolation (no sandbox, no UI).
 * Uses a mock Supabase client to capture DB writes without requiring a live DB.
 *
 * Tasks performed:
 *   1. Log the CTA 538 source spec (constructed fixture — DB unreachable, see FINDING-01)
 *   2. Run compile() directly
 *   3. Run validate() on the compiled output
 *   4. Structural check against V3 Flex golden export format
 *   5. Report all results
 */

import {
  createElementorAdapter,
} from "../adapters/elementor/elementor_adapter_v1.0.0.js";

import type {
  SourceSpec,
  CompiledVariant,
  ExportSafetyFlags,
} from "../adapters/elementor/elementor_adapter_v1.0.0.js";

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── FINDING-01: DB unreachable ───────────────────────────────────────────────
//
// genepress_source_specs cannot be queried at test time because:
//   - No .env file exists in the project root (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY absent)
//   - Local Supabase Docker is not running (Docker daemon unreachable)
//   - No alternative credential source detected
//
// Resolution: CTA 538 source spec constructed as a fixture below, reflecting the
// canonical source_spec_schema_v1 shape. Adapter logic is tested against this fixture.
// Live DB query must be re-run once credentials are available.

// ─── Mock Supabase client ─────────────────────────────────────────────────────

type DbWrite = {
  table: string;
  operation: string;
  data: unknown;
};
const dbWrites: DbWrite[] = [];

function makeMockChain(table: string, operation: string, data?: unknown) {
  if (data !== undefined) {
    dbWrites.push({ table, operation, data });
  }
  const chain: Record<string, unknown> = {};
  const thenFn = (resolve: (v: { data: null; error: null }) => unknown) =>
    Promise.resolve(resolve({ data: null, error: null }));
  chain["then"] = thenFn;
  chain["catch"] = () => chain;
  chain["eq"] = (_col: string, _val: unknown) => chain;
  chain["upsert"] = (d: unknown, _opts?: unknown) => {
    dbWrites.push({ table, operation: "upsert", data: d });
    return { error: null, then: thenFn, catch: () => ({}) };
  };
  chain["insert"] = (d: unknown) => {
    dbWrites.push({ table, operation: "insert", data: d });
    return { then: thenFn, catch: () => ({}) };
  };
  chain["update"] = (d: unknown) => {
    dbWrites.push({ table, operation: "update", data: d });
    return chain;
  };
  return chain;
}

const mockSupabase = {
  from: (table: string) => ({
    upsert: (data: unknown, opts?: unknown) => {
      dbWrites.push({ table, operation: "upsert", data });
      void opts;
      return { error: null, then: (fn: (v: { error: null }) => unknown) => Promise.resolve(fn({ error: null })), catch: () => ({}) };
    },
    insert: (data: unknown) => {
      dbWrites.push({ table, operation: "insert", data });
      return { then: (fn: (v: { data: null; error: null }) => unknown) => Promise.resolve(fn({ data: null, error: null })), catch: () => ({}) };
    },
    update: (data: unknown) => {
      dbWrites.push({ table, operation: "update", data });
      return makeMockChain(table, "update");
    },
    select: (_cols?: string) => ({
      eq: (_col: string, _val: unknown) => ({
        single: () => Promise.resolve({ data: null, error: { message: "Mock DB — no live data" } }),
      }),
    }),
  }),
} as unknown as SupabaseClient;

// ─── CTA 538 Source Spec Fixture ──────────────────────────────────────────────
//
// Component: CTA 538
// A standard call-to-action section with headline, supporting body copy, and
// a primary CTA button. Canonical source_spec_schema_v1 shape.

const CTA_538_SOURCE_SPEC: SourceSpec = {
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

  // Top-level keys
  const requiredTopLevel = ["title", "type", "version", "page_settings", "content"];
  for (const key of requiredTopLevel) {
    if (!(key in compiledJson)) {
      discrepancies.push({
        path: `[root].${key}`,
        expected: "present",
        actual: "missing",
      });
    }
  }

  // version must be "0.4"
  if (compiledJson["version"] !== "0.4") {
    discrepancies.push({
      path: "[root].version",
      expected: '"0.4"',
      actual: JSON.stringify(compiledJson["version"]),
    });
  }

  // content must be an array
  const content = compiledJson["content"];
  if (!Array.isArray(content)) {
    discrepancies.push({
      path: "[root].content",
      expected: "array",
      actual: typeof content,
    });
    return discrepancies;
  }

  // Pro widget type prefixes that must not appear
  const PRO_PREFIXES = [
    "pro-", "woocommerce", "lottie", "form", "hotspot",
    "pro-gallery", "nav-menu", "share-buttons", "paypal-button", "stripe-button",
  ];

  // External script pattern
  const EXTERNAL_SCRIPT_PATTERN = /<script|javascript:/i;

  // Atomic construct role values that must not appear
  const ATOMIC_ROLES = new Set(["atomic_form"]);

  function checkElement(el: unknown, path: string, depth: number): void {
    if (typeof el !== "object" || el === null) {
      discrepancies.push({ path, expected: "object", actual: String(el) });
      return;
    }
    const node = el as Record<string, unknown>;

    // Required keys on every element
    const requiredKeys = ["id", "elType", "isInner", "settings", "elements"];
    for (const key of requiredKeys) {
      if (!(key in node)) {
        discrepancies.push({ path: `${path}.${key}`, expected: "present", actual: "missing" });
      }
    }

    const elType = node["elType"];
    const isInner = node["isInner"];

    // elType must be "container" or "widget"
    if (elType !== "container" && elType !== "widget") {
      discrepancies.push({
        path: `${path}.elType`,
        expected: '"container" | "widget"',
        actual: JSON.stringify(elType),
      });
    }

    // isInner must be false (V3 Flex — no inner sections)
    if (isInner !== false) {
      discrepancies.push({
        path: `${path}.isInner`,
        expected: "false",
        actual: JSON.stringify(isInner),
      });
    }

    if (elType === "widget") {
      // widgetType must be present on widgets
      if (!("widgetType" in node)) {
        discrepancies.push({ path: `${path}.widgetType`, expected: "present", actual: "missing" });
      }

      const widgetType = typeof node["widgetType"] === "string" ? node["widgetType"] : "";

      // No Pro widget types
      for (const prefix of PRO_PREFIXES) {
        if (widgetType.startsWith(prefix)) {
          discrepancies.push({
            path: `${path}.widgetType`,
            expected: "no Pro widget type",
            actual: widgetType,
          });
        }
      }

      // No external script references in settings
      const settings = node["settings"];
      if (typeof settings === "object" && settings !== null) {
        const settingsStr = JSON.stringify(settings);
        if (EXTERNAL_SCRIPT_PATTERN.test(settingsStr)) {
          discrepancies.push({
            path: `${path}.settings`,
            expected: "no external script references",
            actual: "contains <script or javascript:",
          });
        }
      }

      // Widgets must have elements: []
      const elements = node["elements"];
      if (!Array.isArray(elements) || elements.length !== 0) {
        discrepancies.push({
          path: `${path}.elements`,
          expected: "[]",
          actual: JSON.stringify(elements),
        });
      }
    }

    if (elType === "container") {
      // Containers at depth 0 must be root containers (not inner)
      // No atomic constructs in settings
      const settings = node["settings"] as Record<string, unknown> | undefined;
      if (settings && "atomic_form" in settings) {
        discrepancies.push({
          path: `${path}.settings.atomic_form`,
          expected: "absent (no atomic constructs)",
          actual: "present",
        });
      }

      // Check role via the structural rules doesn't surface atomic_form in elType
      // (already checked by elType check above)

      // Recurse into child elements
      const elements = node["elements"];
      if (Array.isArray(elements)) {
        elements.forEach((child, i) => checkElement(child, `${path}.elements[${i}]`, depth + 1));
      }
    }

    // No atomic role markers in element (belt-and-suspenders)
    if (typeof node["role"] === "string" && ATOMIC_ROLES.has(node["role"])) {
      discrepancies.push({
        path: `${path}.role`,
        expected: "no atomic_form role",
        actual: node["role"] as string,
      });
    }
  }

  // Check top-level container nodes
  content.forEach((node, i) => {
    const path = `content[${i}]`;
    checkElement(node, path, 0);

    // Top-level elements must be containers
    if (typeof node === "object" && node !== null) {
      const el = node as Record<string, unknown>;
      if (el["elType"] !== "container") {
        discrepancies.push({
          path: `${path}.elType`,
          expected: '"container" (top-level must be container)',
          actual: JSON.stringify(el["elType"]),
        });
      }
    }
  });

  return discrepancies;
}

// ─── Main test runner ─────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ELEMENTOR ADAPTER ISOLATION TEST — Phase 1B Gate");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── TASK 1: Source spec ──────────────────────────────────────────────────────
  console.log("─── TASK 1: CTA 538 Source Spec ─────────────────────────────");
  console.log("FINDING-01: genepress_source_specs DB query NOT executed.");
  console.log("  Reason: No .env credentials and Docker daemon not running.");
  console.log("  Using constructed fixture matching source_spec_schema_v1:\n");
  console.log(JSON.stringify(CTA_538_SOURCE_SPEC, null, 2));
  console.log();

  // ── TASK 2: compile() ────────────────────────────────────────────────────────
  console.log("─── TASK 2: compile() ───────────────────────────────────────");
  const adapter = createElementorAdapter(mockSupabase);
  let compiled: CompiledVariant;

  try {
    compiled = await adapter.compile(CTA_538_SOURCE_SPEC);
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
  console.log();

  const failingFlags = Object.entries(flags).filter(([, v]) => v);
  if (failingFlags.length === 0) {
    console.log("✓ ALL 7 flags are false — export safety check PASSED.");
  } else {
    console.log(`✗ ${failingFlags.length} flag(s) are TRUE — export safety check FAILED:`);
    for (const [flag, _val] of failingFlags) {
      console.log(`  - ${flag}: true`);
    }
  }
  console.log();

  // ── TASK 4: Structural check vs V3 Flex golden format ────────────────────────
  console.log("─── TASK 4: Structural check vs V3 Flex golden format ───────");
  const discrepancies = checkGoldenStructure(compiled.compiled_json as Record<string, unknown>);

  if (discrepancies.length === 0) {
    console.log("✓ No structural discrepancies found — matches V3 Flex golden format.");
  } else {
    console.log(`✗ ${discrepancies.length} structural discrepancy/discrepancies found:`);
    for (const d of discrepancies) {
      console.log(`  PATH:     ${d.path}`);
      console.log(`  EXPECTED: ${d.expected}`);
      console.log(`  ACTUAL:   ${d.actual}`);
      console.log();
    }
  }
  console.log();

  // ── TASK 5: DB write verification ────────────────────────────────────────────
  console.log("─── TASK 5: DB write verification ───────────────────────────");
  console.log(`Total DB writes captured: ${dbWrites.length}`);
  dbWrites.forEach((w, i) => {
    console.log(`\n  Write [${i + 1}]: table="${w.table}", operation="${w.operation}"`);
    console.log("  Data:", JSON.stringify(w.data, null, 4).split("\n").join("\n  "));
  });

  const variantWrite = dbWrites.find(w => w.table === "genepress_compiled_variants" && w.operation === "upsert");
  const activityWrite = dbWrites.find(w => w.table === "genepress_activity_log" && w.operation === "insert");

  console.log("\n  compile_status written to genepress_compiled_variants:");
  if (variantWrite) {
    const data = variantWrite.data as Record<string, unknown>;
    console.log(`    compile_status = "${data["compile_status"]}" — ${data["compile_status"] === "success" ? "✓ correct" : "✗ WRONG"}`);
  } else {
    console.log("    ✗ No upsert found for genepress_compiled_variants");
  }

  console.log("\n  spec_schema_version in activity log after_state:");
  if (activityWrite) {
    const data = activityWrite.data as Record<string, unknown>;
    const afterState = data["after_state"] as Record<string, unknown>;
    const specSchemaVersion = afterState?.["spec_schema_version"];
    console.log(`    spec_schema_version = "${specSchemaVersion}" — ${specSchemaVersion === "source_spec_schema_v1" ? "✓ correct" : "✗ WRONG or missing"}`);
  } else {
    console.log("    ✗ No insert found for genepress_activity_log");
  }
  console.log();

  // ── SUMMARY ──────────────────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  compile()       : ${compiled.compile_status === "success" ? "✓ success" : "✗ failed"}`);
  console.log(`  compile_status  : ${compiled.compile_status}`);
  console.log(`  warnings        : ${compiled.compile_warnings.length === 0 ? "none" : compiled.compile_warnings.join(", ")}`);
  console.log(`  ExportSafetyFlags: ${failingFlags.length === 0 ? "ALL CLEAR (7/7 false)" : `${failingFlags.length} FLAG(S) RAISED`}`);
  console.log(`  Golden structure: ${discrepancies.length === 0 ? "MATCHES" : `${discrepancies.length} DISCREPANCY/DISCREPANCIES`}`);
  console.log(`  DB writes       : ${dbWrites.length} captured (mock)`);
  console.log(`  FINDING-01      : DB unreachable — spec queried from fixture, not live DB`);
  console.log();

  const gatePass = compiled.compile_status === "success" &&
    failingFlags.length === 0 &&
    discrepancies.length === 0;
  console.log(`  GATE RESULT: ${gatePass ? "✓ PASS — ready to proceed to Phase 1C" : "✗ FAIL — see discrepancies above"}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  process.exit(gatePass ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
