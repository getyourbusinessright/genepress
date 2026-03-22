// GP-1A-05 — Source Spec Generator
// Takes parse output (structural layout tree) + slot_definitions from GP-1A-04 and assembles
// a validated source spec row, then writes it to genepress_source_specs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ParseResult } from "./parse.ts";
import type { SlotDefinition } from "./slot-extractor.ts";

export const PARSER_VERSION = "gp_parser_v1";
export const SPEC_SCHEMA_VERSION = "source_spec_schema_v1" as const;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Enriched slot for the spec.
 * slot_type here is structural: "singleton" | "repeating_group"
 * (distinct from the semantic slot_type used in the classifier).
 */
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

/** One node in the builder-agnostic structural layout tree. */
export type StructuralNode = {
  container_id: string;
  role: string;
  slot_ref: string | null;
  flex_direction: string | null;
  padding: Record<string, unknown> | null;
  background: Record<string, unknown> | null;
  children: string[]; // container_ids of immediate children
};

export type SpecIntakeContext = {
  component_id: string;
  source_id: string;
  source_checksum: string;
  parser_version: string;
  sanitization_status: string;
};

export type GenerateSpecResult = {
  success: boolean;
  spec_id: string;
  validation_result: "passed" | "failed";
  validation_errors?: string[];
};

// ─── Slot transformation ──────────────────────────────────────────────────────

function toStructuralSlotType(semanticType: string): "singleton" | "repeating_group" {
  return semanticType === "list" ? "repeating_group" : "singleton";
}

/**
 * Produces the item_slots array required for repeating_group slots.
 * The item_slots themselves are always singletons.
 */
function buildItemSlots(parentSlotName: string): SpecSlotDefinition[] {
  return [
    {
      slot_id: `${parentSlotName}_item_text`,
      slot_type: "singleton",
      semantic_type: "text_body",
      required: true,
      parent_container: parentSlotName,
      constraints: { max_chars: 120 },
      notes: "Auto-generated item text slot for repeating_group.",
    },
    {
      slot_id: `${parentSlotName}_item_icon`,
      slot_type: "singleton",
      semantic_type: "icon",
      required: false,
      parent_container: parentSlotName,
      constraints: {},
      notes: "Auto-generated item icon slot for repeating_group.",
    },
  ];
}

function buildSpecSlotDefinitions(rawSlots: SlotDefinition[]): SpecSlotDefinition[] {
  return rawSlots.map((s) => {
    const structural_type = toStructuralSlotType(s.slot_type);

    const constraints: Record<string, unknown> = {};
    if (s.max_chars !== null) constraints.max_chars = s.max_chars;
    if (s.aspect_ratio !== null) constraints.aspect_ratio = s.aspect_ratio;
    if (s.max_items !== null) constraints.max_items = s.max_items;
    if (s.item_schema !== null) constraints.item_schema = s.item_schema;

    const def: SpecSlotDefinition = {
      slot_id: s.slot_name,
      slot_type: structural_type,
      semantic_type: s.slot_type,
      required: s.required,
      parent_container: null, // filled in after structural rules are built
      constraints,
      notes: s.notes,
    };

    if (structural_type === "repeating_group") {
      def.item_slots = buildItemSlots(s.slot_name);
    }

    return def;
  });
}

// ─── Structural rules builder ─────────────────────────────────────────────────

function extractLayoutProps(
  settings: Record<string, unknown>,
  role: string,
): {
  flex_direction: string | null;
  padding: Record<string, unknown> | null;
  background: Record<string, unknown> | null;
} {
  // flex_direction — explicit or inferred from container type
  let flex_direction: string | null = null;
  if (typeof settings.flex_direction === "string" && settings.flex_direction) {
    flex_direction = settings.flex_direction;
  } else if (role === "section" || role === "container") {
    flex_direction = "row"; // Elementor sections are horizontal by default
  } else if (role === "column") {
    flex_direction = "column";
  }

  // padding
  let padding: Record<string, unknown> | null = null;
  if (settings.padding && typeof settings.padding === "object" && !Array.isArray(settings.padding)) {
    padding = settings.padding as Record<string, unknown>;
  } else if (settings._padding && typeof settings._padding === "object" && !Array.isArray(settings._padding)) {
    padding = settings._padding as Record<string, unknown>;
  }

  // background
  let background: Record<string, unknown> | null = null;
  const bgColor = typeof settings.background_color === "string" ? settings.background_color : null;
  const bgType = typeof settings.background_type === "string" ? settings.background_type : null;
  const bgImage = settings.background_image && typeof settings.background_image === "object"
    ? settings.background_image as Record<string, unknown>
    : null;

  if (bgColor || bgType || bgImage) {
    background = {};
    if (bgColor) background.color = bgColor;
    if (bgType) background.type = bgType;
    if (bgImage) background.image = bgImage;
  }

  return { flex_direction, padding, background };
}

/**
 * Maps Elementor widget types / elTypes to the semantic_type used in slot definitions.
 * Used to assign slot_ref on each structural node.
 */
const ROLE_TO_SEMANTIC: Record<string, string> = {
  heading: "text_headline",
  "text-editor": "text_body",
  button: "cta",
  image: "image",
  "icon-list": "list",
};

function buildStructuralRules(
  parseResult: ParseResult,
  specSlots: SpecSlotDefinition[],
): StructuralNode[] {
  // Map original element JSON id → region_id for child resolution
  const elementIdToRegionId = new Map<string, string>();
  for (const region of parseResult.raw_regions) {
    const raw = region.raw_json as Record<string, unknown>;
    if (typeof raw.id === "string" && raw.id) {
      elementIdToRegionId.set(raw.id, region.region_id);
    }
  }

  // Group slots by semantic_type so we can assign slot_refs in order
  const semanticToSlotQueue = new Map<string, string[]>();
  for (const slot of specSlots) {
    const q = semanticToSlotQueue.get(slot.semantic_type) ?? [];
    q.push(slot.slot_id);
    semanticToSlotQueue.set(slot.semantic_type, q);
  }
  // Track which slots have been assigned to prevent duplicates
  const assignedSlots = new Set<string>();

  const nodes: StructuralNode[] = [];

  for (const region of parseResult.raw_regions) {
    const raw = region.raw_json as Record<string, unknown>;
    const settings = (raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings))
      ? (raw.settings as Record<string, unknown>)
      : {};

    // role: widgetType takes precedence (leaf nodes), then elType (containers), then type (Figma)
    const role =
      (typeof raw.widgetType === "string" && raw.widgetType) ? raw.widgetType :
      (typeof raw.elType === "string" && raw.elType) ? raw.elType :
      (typeof raw.type === "string" && raw.type) ? raw.type :
      "unknown";

    const { flex_direction, padding, background } = extractLayoutProps(settings, role);

    // children: resolve from raw.elements using the ID map
    const children: string[] = [];
    if (Array.isArray(raw.elements)) {
      for (const child of raw.elements as Record<string, unknown>[]) {
        if (child && typeof child.id === "string") {
          const childRegionId = elementIdToRegionId.get(child.id);
          if (childRegionId) children.push(childRegionId);
        }
      }
    }
    // Figma uses 'children' key
    if (Array.isArray(raw.children)) {
      for (const child of raw.children as Record<string, unknown>[]) {
        if (child && typeof child.id === "string") {
          const childRegionId = elementIdToRegionId.get(child.id);
          if (childRegionId) children.push(childRegionId);
        }
      }
    }

    // slot_ref: assign the next unassigned slot matching this node's role
    let slot_ref: string | null = null;
    const semanticType = ROLE_TO_SEMANTIC[role];
    if (semanticType) {
      const queue = semanticToSlotQueue.get(semanticType) ?? [];
      for (const candidate of queue) {
        if (!assignedSlots.has(candidate)) {
          slot_ref = candidate;
          assignedSlots.add(candidate);
          break;
        }
      }
    }

    nodes.push({
      container_id: region.region_id,
      role,
      slot_ref,
      flex_direction,
      padding,
      background,
      children,
    });
  }

  return nodes;
}

/**
 * Derives parent_container for each slot by finding the structural node that
 * contains (as a child) the node which holds this slot's slot_ref.
 */
function resolveParentContainers(
  specSlots: SpecSlotDefinition[],
  structuralNodes: StructuralNode[],
): void {
  // slot_id → container_id of the structural node that holds this slot_ref
  const slotRefToNodeId = new Map<string, string>();
  for (const node of structuralNodes) {
    if (node.slot_ref) slotRefToNodeId.set(node.slot_ref, node.container_id);
  }

  // container_id → parent container_id
  const nodeIdToParent = new Map<string, string>();
  for (const node of structuralNodes) {
    for (const childId of node.children) {
      nodeIdToParent.set(childId, node.container_id);
    }
  }

  for (const slot of specSlots) {
    const nodeId = slotRefToNodeId.get(slot.slot_id);
    if (nodeId) {
      slot.parent_container = nodeIdToParent.get(nodeId) ?? null;
    }
    // Update nested item_slots parent_container too (already set to slot_id, no change needed)
  }
}

// ─── Spec schema validation ───────────────────────────────────────────────────

export type SpecValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validateSpecSchema(spec: {
  slot_definitions: unknown;
  structural_rules: unknown;
  spec_schema_version: unknown;
}): SpecValidationResult {
  const errors: string[] = [];

  // slot_definitions: non-empty array
  if (!Array.isArray(spec.slot_definitions) || spec.slot_definitions.length === 0) {
    errors.push("slot_definitions must be a non-empty array");
  } else {
    for (const raw of spec.slot_definitions as unknown[]) {
      if (!raw || typeof raw !== "object") {
        errors.push("Each slot_definition entry must be an object");
        continue;
      }
      const s = raw as Record<string, unknown>;
      const id = typeof s.slot_id === "string" ? s.slot_id : "(unknown)";

      if (!s.slot_id || typeof s.slot_id !== "string") {
        errors.push(`Slot missing slot_id: ${JSON.stringify(s)}`);
      }
      if (s.slot_type !== "singleton" && s.slot_type !== "repeating_group") {
        errors.push(
          `Slot "${id}" slot_type must be "singleton" or "repeating_group", got: "${s.slot_type}"`,
        );
      }
      if (!s.semantic_type || typeof s.semantic_type !== "string") {
        errors.push(`Slot "${id}" is missing semantic_type`);
      }
      if (typeof s.required !== "boolean") {
        errors.push(`Slot "${id}" required must be a boolean`);
      }
      if (!("parent_container" in s)) {
        errors.push(`Slot "${id}" is missing parent_container field`);
      }
      if (!s.constraints || typeof s.constraints !== "object" || Array.isArray(s.constraints)) {
        errors.push(`Slot "${id}" is missing constraints object`);
      }
      // repeating_group must have non-empty item_slots
      if (s.slot_type === "repeating_group") {
        if (!Array.isArray(s.item_slots) || (s.item_slots as unknown[]).length === 0) {
          errors.push(
            `Slot "${id}" is repeating_group but item_slots is missing or empty`,
          );
        }
      }
    }
  }

  // structural_rules: non-empty array
  if (!Array.isArray(spec.structural_rules) || spec.structural_rules.length === 0) {
    errors.push("structural_rules must be a non-empty array");
  }

  // spec_schema_version must equal "source_spec_schema_v1"
  if (!spec.spec_schema_version || spec.spec_schema_version !== SPEC_SCHEMA_VERSION) {
    errors.push(
      `spec_schema_version must be "${SPEC_SCHEMA_VERSION}", got: "${spec.spec_schema_version}"`,
    );
  }

  return { valid: errors.length === 0, errors };
}

// ─── Public: generate + persist ──────────────────────────────────────────────

export async function generateAndPersistSpec(
  supabase: ReturnType<typeof createClient>,
  parseResult: ParseResult,
  rawSlots: SlotDefinition[],
  ctx: SpecIntakeContext,
): Promise<GenerateSpecResult> {
  const { component_id, source_id, source_checksum, parser_version, sanitization_status } = ctx;

  // 1. Transform raw slot definitions into spec format (singleton / repeating_group)
  const specSlotDefs = buildSpecSlotDefinitions(rawSlots);

  // 2. Build the structural layout tree from parse output
  const structuralNodes = buildStructuralRules(parseResult, specSlotDefs);

  // 3. Back-fill parent_container on each slot now that structural tree is ready
  resolveParentContainers(specSlotDefs, structuralNodes);

  // 4. Determine spec version: count existing specs for this component_id
  const { count: existingCount, error: countError } = await supabase
    .from("genepress_source_specs")
    .select("*", { count: "exact", head: true })
    .eq("component_id", component_id);

  if (countError) {
    console.error("[spec-generator] Version count query failed:", countError.message);
    throw new Error(`Failed to determine spec version: ${countError.message}`);
  }

  const specVersion = (existingCount ?? 0) + 1;
  const spec_id = `spec_${component_id}_v${specVersion}`;

  // 5. Assemble spec payload for validation
  const specPayload = {
    slot_definitions: specSlotDefs,
    structural_rules: structuralNodes,
    spec_schema_version: SPEC_SCHEMA_VERSION,
    spec_origin: "intake" as const,
    source_checksum,
    parser_version,
    sanitization_status,
  };

  // 6. Validate against source_spec_schema_v1 contract
  const validation = validateSpecSchema(specPayload);
  const validation_result: "passed" | "failed" = validation.valid ? "passed" : "failed";

  // 7. Insert spec row (includes validation_result so the record is always written)
  const { error: insertError } = await supabase
    .from("genepress_source_specs")
    .insert({
      spec_id,
      component_id,
      source_id,
      slot_definitions: specSlotDefs,
      structural_rules: structuralNodes,
      spec_schema_version: SPEC_SCHEMA_VERSION,
      spec_origin: "intake",
      source_checksum,
      parser_version,
      sanitization_status,
      validation_result,
      operator_id: null,
      ingestion_date: new Date().toISOString(),
    });

  if (insertError) {
    console.error("[spec-generator] genepress_source_specs insert failed:", insertError.message);
    throw new Error(`Failed to insert spec row: ${insertError.message}`);
  }

  // 8. Update genepress_components status
  const newComponentStatus = validation.valid ? "spec_generated" : "parse_failed";

  const { error: statusError } = await supabase
    .from("genepress_components")
    .update({ status: newComponentStatus })
    .eq("component_id", component_id);

  if (statusError) {
    console.error(
      "[spec-generator] genepress_components status update failed:",
      statusError.message,
    );
  }

  // 9. Activity log
  if (validation.valid) {
    // Addendum A A-03.4: spec_generated entry must include spec_schema_version in after_state
    const { error: logError } = await supabase.rpc("log_genepress_activity", {
      p_component_id: component_id,
      p_action_type: "spec_generated",
      p_actor: "system",
      p_before_state: { status: "classification_complete" },
      p_after_state: {
        spec_id,
        spec_schema_version: SPEC_SCHEMA_VERSION,
        slot_count: specSlotDefs.length,
        validation_result: "passed",
        parser_version,
      },
    });

    if (logError) {
      console.error(
        "[spec-generator] Activity log write failed [spec_generated]:",
        JSON.stringify(logError),
      );
    }
  } else {
    // Validation failed: log spec_validation_error with failure details
    const { error: logError } = await supabase.rpc("log_genepress_activity", {
      p_component_id: component_id,
      p_action_type: "spec_validation_error",
      p_actor: "system",
      p_before_state: { status: "classification_complete" },
      p_after_state: {
        spec_id,
        spec_schema_version: SPEC_SCHEMA_VERSION,
        validation_result: "failed",
        validation_errors: validation.errors,
      },
    });

    if (logError) {
      console.error(
        "[spec-generator] Activity log write failed [spec_validation_error]:",
        JSON.stringify(logError),
      );
    }
  }

  return {
    success: true,
    spec_id,
    validation_result,
    ...(validation.valid ? {} : { validation_errors: validation.errors }),
  };
}
