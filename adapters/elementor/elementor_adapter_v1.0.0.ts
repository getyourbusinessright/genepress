/**
 * GP-1B-01 — Elementor Free Adapter v1.0.0
 *
 * Implements BuilderAdapter for Elementor Free in Flex Container (Flexbox) mode.
 * Targets source_spec_schema_v1. Writes compiled variants to genepress_compiled_variants
 * and emits audit entries to genepress_activity_log.
 *
 * DO NOT:
 *   - Call the Export Package Assembler from here — that is a separate layer.
 *   - Touch sandbox verification — that is Phase 1C (GP.7).
 *   - Use Elementor Pro or V4 JSON keys — this adapter targets Free/Flex only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import MANIFEST from "../../sandbox/manifest.json";

// ─── Spec types (mirrors spec-generator.ts, kept local to avoid cross-package deps) ──

export type SpecSlotDefinition = {
  slot_id: string;
  slot_type: "singleton" | "repeating_group";
  semantic_type: string;
  required: boolean;
  parent_container: string | null;
  constraints: Record<string, unknown>;
  item_slots?: SpecSlotDefinition[];
  notes: string;
};

export type StructuralNode = {
  container_id: string;
  role: string;
  slot_ref: string | null;
  flex_direction: string | null;
  padding: Record<string, unknown> | null;
  background: Record<string, unknown> | null;
  children: string[];
};

// ─── Public interface types ────────────────────────────────────────────────────

export type SourceSpec = {
  spec_id: string;
  component_id: string;
  source_id: string | null;
  spec_schema_version: string;
  spec_origin: string;
  slot_definitions: SpecSlotDefinition[];
  structural_rules: StructuralNode[];
  validation_result: string | null;
  source_checksum: string | null;
  parser_version: string | null;
  /** Optional human-readable name used as the compiled title. */
  display_name?: string;
};

export type CompiledVariant = {
  variant_id: string;
  spec_id: string;
  component_id: string;
  compiled_json: object;
  compile_status: "success" | "failure";
  compile_warnings: string[];
  is_active: boolean;
  capability_profile: object;
  downgrade_path: object;
  builder_version: string;
  adapter_version: string;
  target_editor_mode: string;
  fixture_suite_version: string;
};

export type ExportSafetyFlags = {
  has_unsupported_widgets: boolean;
  has_forbidden_nesting: boolean;
  has_unapproved_plugin_dependency: boolean;
  has_external_code_references: boolean;
  has_broken_mobile_overflow: boolean;
  has_custom_js_requirement: boolean;
  has_uncontrolled_asset_references: boolean;
};

export type TestResult = {
  test_status: "pending" | "passed" | "failed" | "skipped";
  message: string;
  sandbox_url?: string;
};

// ─── BuilderAdapter interface ──────────────────────────────────────────────────

export interface BuilderAdapter {
  builder: string;
  adapterVersion: string;
  supportedBuilderVersions: string[];
  supportedEditorModes: string[];
  supportedSpecVersions: string[];
  capabilities: {
    supports_variables: boolean;
    supports_classes: boolean;
    supports_states: boolean;
    supports_components: boolean;
    supports_dynamic_tags: boolean;
    supports_html_attributes: boolean;
    supports_atomic_forms: boolean;
    supports_interactions: boolean;
    supports_breakpoint_specific_interactions: boolean;
    supports_custom_effects: boolean;
    supports_scroll_triggered_effects: boolean;
  };
  downgradeRules: {
    inline_variables: boolean;
    flatten_classes: boolean;
    strip_states: boolean;
    strip_atomic_constructs: boolean;
    fail_on_no_safe_downgrade: boolean;
  };
  compile(sourceSpec: SourceSpec): Promise<CompiledVariant>;
  validate(compiledJson: object): ExportSafetyFlags;
  test(sourceSpec: SourceSpec, sandboxUrl: string): Promise<TestResult>;
}

// ─── Constants from sandbox manifest ──────────────────────────────────────────

const BUILDER_VERSION = MANIFEST.sandbox.elementor_free.version; // "3.27.5"
const FIXTURE_SUITE_VERSION = MANIFEST.fixture_suite_version;    // "fixture_suite_v1.0.0"
const ADAPTER_VERSION = "elementor_adapter_v1.0.0";
const SPEC_SCHEMA_VERSION = "source_spec_schema_v1";

// ─── Elementor Free widget allow-list ─────────────────────────────────────────

const ALLOWED_WIDGET_TYPES = new Set([
  "heading",
  "text-editor",
  "button",
  "image",
  "icon-list",
]);

// Widget types that indicate an unapproved plugin dependency.
const BANNED_WIDGET_PREFIXES = [
  "pro-",
  "woocommerce",
  "lottie",
  "form",
  "hotspot",
  "pro-gallery",
  "nav-menu",
  "share-buttons",
  "paypal-button",
  "stripe-button",
];

// ─── Slot → Elementor widget mapping ─────────────────────────────────────────

type WidgetMapping = {
  widgetType: string;
  buildSettings: (slot: SpecSlotDefinition) => Record<string, unknown>;
};

const WIDGET_MAP: Record<string, WidgetMapping> = {
  text_headline: {
    widgetType: "heading",
    buildSettings: () => ({
      title: "",
      header_size: "h2",
      align: "left",
    }),
  },
  text_body: {
    widgetType: "text-editor",
    buildSettings: () => ({
      editor: "",
    }),
  },
  cta: {
    widgetType: "button",
    buildSettings: () => ({
      text: "",
      link: { url: "", is_external: false, nofollow: false },
      align: "left",
    }),
  },
  image: {
    widgetType: "image",
    buildSettings: () => ({
      image: { url: "", id: "" },
      image_size: "full",
      align: "center",
    }),
  },
  list: {
    widgetType: "icon-list",
    buildSettings: () => ({
      icon_list: [
        {
          text: "",
          selected_icon: { value: "fas fa-check", library: "fa-solid" },
        },
      ],
    }),
  },
};

// ─── Deterministic ID generation ──────────────────────────────────────────────

/**
 * Produces a deterministic 8-character lowercase hex ID from an arbitrary
 * string using FNV-1a 32-bit. No async crypto required.
 */
function hashId(input: string): string {
  let hash = 2166136261; // FNV-1a 32-bit offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV-1a 32-bit prime via Math.imul for correct 32-bit overflow
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 8);
}

// ─── Elementor element builders ───────────────────────────────────────────────

type ElementorElement = Record<string, unknown>;

function buildWidgetElement(
  node: StructuralNode,
  slot: SpecSlotDefinition,
): ElementorElement {
  const mapping = WIDGET_MAP[slot.semantic_type];
  if (!mapping) {
    // Unsupported semantic type — emit empty container to avoid data loss
    return buildContainerElement(node, []);
  }

  return {
    id: hashId(node.container_id),
    elType: "widget",
    widgetType: mapping.widgetType,
    isInner: false,
    settings: mapping.buildSettings(slot),
    elements: [],
  };
}

function buildContainerElement(
  node: StructuralNode,
  childElements: ElementorElement[],
): ElementorElement {
  const paddingBase = { unit: "px", top: "", right: "", bottom: "", left: "", isLinked: false };
  const sourcePadding =
    node.padding &&
    typeof node.padding === "object" &&
    !Array.isArray(node.padding)
      ? (node.padding as Record<string, unknown>)
      : {};

  const padding = {
    ...paddingBase,
    ...(sourcePadding.top !== undefined ? { top: String(sourcePadding.top) } : {}),
    ...(sourcePadding.right !== undefined ? { right: String(sourcePadding.right) } : {}),
    ...(sourcePadding.bottom !== undefined ? { bottom: String(sourcePadding.bottom) } : {}),
    ...(sourcePadding.left !== undefined ? { left: String(sourcePadding.left) } : {}),
  };

  return {
    id: hashId(node.container_id),
    elType: "container",
    isInner: false,
    settings: {
      flex_direction: node.flex_direction ?? "row",
      justify_content: "flex-start",
      align_items: "stretch",
      padding,
    },
    elements: childElements,
  };
}

// ─── Tree compiler ────────────────────────────────────────────────────────────

function compileTree(
  structuralRules: StructuralNode[],
  slotDefinitions: SpecSlotDefinition[],
): ElementorElement[] {
  const nodeMap = new Map<string, StructuralNode>(
    structuralRules.map((n) => [n.container_id, n]),
  );
  const slotMap = new Map<string, SpecSlotDefinition>(
    slotDefinitions.map((s) => [s.slot_id, s]),
  );

  // Find root nodes — those not referenced as children by any other node.
  const childIdSet = new Set<string>(structuralRules.flatMap((n) => n.children));
  const rootNodes = structuralRules.filter((n) => !childIdSet.has(n.container_id));

  function buildElement(node: StructuralNode): ElementorElement {
    if (node.slot_ref) {
      const slot = slotMap.get(node.slot_ref);
      if (slot) {
        return buildWidgetElement(node, slot);
      }
    }

    // Container: recurse into children
    const childElements = node.children
      .map((cid) => nodeMap.get(cid))
      .filter((n): n is StructuralNode => n !== undefined)
      .map(buildElement);

    return buildContainerElement(node, childElements);
  }

  return rootNodes.map(buildElement);
}

// ─── Downgrade pass ───────────────────────────────────────────────────────────

/**
 * Applies downgrade rules to the structural_rules and slot_definitions before
 * serialization. For v1.0.0 (no variables, classes, states, atomic constructs),
 * this is mostly a no-op because the spec pipeline already strips them upstream.
 * Returns warnings for any constructs encountered and stripped.
 */
function applyDowngradeRules(
  slotDefinitions: SpecSlotDefinition[],
  structuralRules: StructuralNode[],
): { slots: SpecSlotDefinition[]; rules: StructuralNode[]; warnings: string[] } {
  const warnings: string[] = [];

  // strip_states: remove any state-specific overrides embedded in constraints
  const slots = slotDefinitions.map((slot) => {
    const { states: _states, classes: _classes, variables: _variables, ...safeConstraints } =
      slot.constraints as Record<string, unknown>;
    if (_states !== undefined) warnings.push(`Stripped states from slot ${slot.slot_id}`);
    if (_classes !== undefined) warnings.push(`Stripped classes from slot ${slot.slot_id}`);
    if (_variables !== undefined) warnings.push(`Inlined variables from slot ${slot.slot_id}`);
    return { ...slot, constraints: safeConstraints };
  });

  // strip_atomic_constructs: remove atomic_form refs from structural_rules
  const rules = structuralRules.map((node) => {
    if (node.role === "atomic_form") {
      warnings.push(`Stripped atomic_form construct from container ${node.container_id}`);
      return { ...node, role: "container" };
    }
    return node;
  });

  return { slots, rules, warnings };
}

// ─── Validation ───────────────────────────────────────────────────────────────

function computeExportSafetyFlags(compiledJson: object): ExportSafetyFlags {
  const flags: ExportSafetyFlags = {
    has_unsupported_widgets: false,
    has_forbidden_nesting: false,
    has_unapproved_plugin_dependency: false,
    has_external_code_references: false,
    has_broken_mobile_overflow: false,
    has_custom_js_requirement: false,
    has_uncontrolled_asset_references: false,
  };

  function walkElements(elements: unknown, parentElType?: string): void {
    if (!Array.isArray(elements)) return;

    for (const el of elements) {
      if (typeof el !== "object" || el === null) continue;
      const node = el as Record<string, unknown>;
      const elType = typeof node.elType === "string" ? node.elType : "";
      const widgetType = typeof node.widgetType === "string" ? node.widgetType : "";

      if (elType === "widget") {
        // Unsupported widget types
        if (widgetType && !ALLOWED_WIDGET_TYPES.has(widgetType)) {
          flags.has_unsupported_widgets = true;
        }

        // Unapproved plugin dependency
        if (BANNED_WIDGET_PREFIXES.some((p) => widgetType.startsWith(p))) {
          flags.has_unapproved_plugin_dependency = true;
        }

        // Forbidden nesting: widget inside a widget
        if (parentElType === "widget") {
          flags.has_forbidden_nesting = true;
        }

        const settings =
          typeof node.settings === "object" && node.settings !== null
            ? (node.settings as Record<string, unknown>)
            : {};

        // Custom JS requirement
        if (
          settings.custom_js ||
          Object.keys(settings).some((k) => k.startsWith("__dynamic__"))
        ) {
          flags.has_custom_js_requirement = true;
        }

        // External code references (raw HTML widgets with scripts)
        if (
          typeof settings.html === "string" &&
          (settings.html.includes("<script") || settings.html.includes("javascript:"))
        ) {
          flags.has_external_code_references = true;
        }

        // Uncontrolled external asset references
        const imageSettings = settings.image;
        if (
          typeof imageSettings === "object" &&
          imageSettings !== null &&
          typeof (imageSettings as Record<string, unknown>).url === "string" &&
          ((imageSettings as Record<string, unknown>).url as string).startsWith("http")
        ) {
          flags.has_uncontrolled_asset_references = true;
        }

        // Broken mobile overflow: fixed pixel widths wider than mobile breakpoint
        const widthSettings = settings.width;
        if (
          typeof widthSettings === "object" &&
          widthSettings !== null
        ) {
          const w = widthSettings as Record<string, unknown>;
          if (w.unit === "px" && typeof w.size === "number" && (w.size as number) > 768) {
            flags.has_broken_mobile_overflow = true;
          }
        }
      }

      // Recurse into child elements
      if (Array.isArray(node.elements)) {
        walkElements(node.elements, elType);
      }
    }
  }

  const doc = compiledJson as Record<string, unknown>;
  if (Array.isArray(doc.content)) {
    walkElements(doc.content);
  }

  return flags;
}

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a fully-wired ElementorAdapter instance.
 *
 * @param supabase - A Supabase client with permission to write to
 *   genepress_compiled_variants and genepress_activity_log.
 */
export function createElementorAdapter(supabase: SupabaseClient): BuilderAdapter {
  const capabilities: BuilderAdapter["capabilities"] = {
    supports_variables: false,
    supports_classes: false,
    supports_states: false,
    supports_components: false,
    supports_dynamic_tags: true,
    supports_html_attributes: false,
    supports_atomic_forms: false,
    supports_interactions: true,
    supports_breakpoint_specific_interactions: false,
    supports_custom_effects: false,
    supports_scroll_triggered_effects: true,
  };

  const downgradeRules: BuilderAdapter["downgradeRules"] = {
    inline_variables: true,
    flatten_classes: true,
    strip_states: true,
    strip_atomic_constructs: true,
    fail_on_no_safe_downgrade: true,
  };

  async function compile(sourceSpec: SourceSpec): Promise<CompiledVariant> {
    const { spec_id, component_id, source_id, spec_schema_version } = sourceSpec;
    const variantId = `build_${component_id}_elementor_${BUILDER_VERSION}_${ADAPTER_VERSION}`;

    try {
      // 1. Apply downgrade rules before serialization
      const { slots: safeSlots, rules: safeRules, warnings } = applyDowngradeRules(
        sourceSpec.slot_definitions,
        sourceSpec.structural_rules,
      );

      // 2. Compile structural_rules + slot_definitions → Elementor JSON
      const content = compileTree(safeRules, safeSlots);
      const compiledJson = {
        title: sourceSpec.display_name ?? component_id,
        type: "section",
        version: "0.4",
        page_settings: [],
        content,
      };

      // 3. Validate and compute export safety flags
      const exportSafetyFlags = computeExportSafetyFlags(compiledJson);
      const hasValidationFailure = Object.values(exportSafetyFlags).some(Boolean);
      if (hasValidationFailure && downgradeRules.fail_on_no_safe_downgrade) {
        const failingFlags = Object.entries(exportSafetyFlags)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(", ");
        warnings.push(`Export safety flags raised: ${failingFlags}`);
      }

      // 4. Write to genepress_compiled_variants
      const variantRow = {
        id: variantId,
        spec_id,
        source_id: source_id ?? undefined,
        variant_key: variantId,
        compiled_data: compiledJson,
        compiled_json: compiledJson,
        compile_status: "success",
        error_message: null,
        compiled_at: new Date().toISOString(),
        compile_warnings: warnings,
        is_active: true,
        capability_profile: capabilities,
        downgrade_path: downgradeRules,
        builder_version: BUILDER_VERSION,
        adapter_version: ADAPTER_VERSION,
        target_editor_mode: "flex",
        component_id,
        export_safety_flags: exportSafetyFlags,
        fixture_suite_version: FIXTURE_SUITE_VERSION,
      };

      const { error: insertError } = await supabase
        .from("genepress_compiled_variants")
        .upsert(variantRow, { onConflict: "id" });

      if (insertError) throw insertError;

      // 5. Log compile success to genepress_activity_log
      await supabase.from("genepress_activity_log").insert({
        action_type: "compile_succeeded",
        component_id: component_id,
        before_state: null,
        after_state: {
          variant_id: variantId,
          spec_id,
          spec_schema_version: spec_schema_version ?? SPEC_SCHEMA_VERSION,
          adapter_version: ADAPTER_VERSION,
          builder_version: BUILDER_VERSION,
          target_editor_mode: "flex",
          compile_warnings: warnings,
          export_safety_flags: exportSafetyFlags,
        },
        performed_by: "system",
      });

      return {
        variant_id: variantId,
        spec_id,
        component_id,
        compiled_json: compiledJson,
        compile_status: "success",
        compile_warnings: warnings,
        is_active: true,
        capability_profile: capabilities,
        downgrade_path: downgradeRules,
        builder_version: BUILDER_VERSION,
        adapter_version: ADAPTER_VERSION,
        target_editor_mode: "flex",
        fixture_suite_version: FIXTURE_SUITE_VERSION,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Log compile failure
      await supabase
        .from("genepress_activity_log")
        .insert({
          action_type: "compile_failed",
          component_id: component_id,
          before_state: null,
          after_state: {
            variant_id: variantId,
            spec_id,
            spec_schema_version: sourceSpec.spec_schema_version ?? SPEC_SCHEMA_VERSION,
            adapter_version: ADAPTER_VERSION,
            builder_version: BUILDER_VERSION,
            error: errorMessage,
          },
          performed_by: "system",
        })
        .then(() => void 0)
        .catch(() => void 0); // never let log failure surface compile error

      throw err;
    }
  }

  function validate(compiledJson: object): ExportSafetyFlags {
    const flags = computeExportSafetyFlags(compiledJson);

    // Best-effort update of the matching compiled_variants row.
    // Fire-and-forget — validate() is synchronous in the public API.
    supabase
      .from("genepress_compiled_variants")
      .update({ export_safety_flags: flags })
      .eq("compiled_json", compiledJson)
      .then(() => void 0)
      .catch(() => void 0);

    return flags;
  }

  async function test(
    _sourceSpec: SourceSpec,
    sandboxUrl: string,
  ): Promise<TestResult> {
    // GP.7 adapter test mode — stub for Phase 1C.
    // Full implementation: render compiled variant in headless sandbox at sandboxUrl,
    // capture screenshots, run layout assertions, and return pass/fail with details.
    void sandboxUrl; // acknowledged; not used in stub
    return {
      test_status: "pending",
      message:
        "Adapter test mode not yet implemented. Full sandbox verification is Phase 1C (GP.7).",
      sandbox_url: sandboxUrl,
    };
  }

  return {
    builder: "elementor",
    adapterVersion: ADAPTER_VERSION,
    supportedBuilderVersions: [BUILDER_VERSION],
    supportedEditorModes: ["flex"],
    supportedSpecVersions: [SPEC_SCHEMA_VERSION],
    capabilities,
    downgradeRules,
    compile,
    validate,
    test,
  };
}
