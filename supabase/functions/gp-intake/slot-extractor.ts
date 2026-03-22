// Task 4 — Slot Extraction (Checkpoint 4)
// Converts classified regions into named slot definitions ready for genepress_source_specs.

import type { ClassifiedRegion } from "./classify-heuristic.ts";

export type SlotDefinition = {
  slot_name: string;
  slot_type: string;
  required: boolean;
  max_chars: number | null;
  aspect_ratio: string | null;
  max_items: number | null;
  item_schema: object | null;
  notes: string;
};

export type SlotExtractionResult = {
  slot_definitions: SlotDefinition[];
  has_unresolved: boolean;
  unresolved_regions: ClassifiedRegion[];
};

// ─── Slot naming helpers ──────────────────────────────────────────────────────

function ordinal(n: number): string {
  // Returns "", "_2", "_3" ... for sequential naming
  return n === 1 ? "" : `_${n}`;
}

function makeTextHeadlineDef(
  slot_name: string,
  region: ClassifiedRegion,
): SlotDefinition {
  return {
    slot_name,
    slot_type: "text_headline",
    required: true,
    max_chars: 80,
    aspect_ratio: null,
    max_items: null,
    item_schema: null,
    notes: `Classified from region "${region.element_name ?? region.region_id}" with confidence ${region.confidence}.`,
  };
}

function makeTextBodyDef(
  slot_name: string,
  region: ClassifiedRegion,
): SlotDefinition {
  return {
    slot_name,
    slot_type: "text_body",
    required: false,
    max_chars: 300,
    aspect_ratio: null,
    max_items: null,
    item_schema: null,
    notes: `Classified from region "${region.element_name ?? region.region_id}" with confidence ${region.confidence}.`,
  };
}

function makeCtaDef(
  slot_name: string,
  region: ClassifiedRegion,
): SlotDefinition {
  return {
    slot_name,
    slot_type: "cta",
    required: true,
    max_chars: 40,
    aspect_ratio: null,
    max_items: null,
    item_schema: null,
    notes: `Classified from region "${region.element_name ?? region.region_id}" with confidence ${region.confidence}.`,
  };
}

function makeImageDef(
  slot_name: string,
  region: ClassifiedRegion,
): SlotDefinition {
  return {
    slot_name,
    slot_type: "image",
    required: false,
    max_chars: null,
    aspect_ratio: "16:9",
    max_items: null,
    item_schema: null,
    notes: `Classified from region "${region.element_name ?? region.region_id}" with confidence ${region.confidence}.`,
  };
}

function makeListDef(
  slot_name: string,
  region: ClassifiedRegion,
): SlotDefinition {
  return {
    slot_name,
    slot_type: "list",
    required: false,
    max_chars: null,
    aspect_ratio: null,
    max_items: 6,
    item_schema: { text: "string", icon: "string | null" },
    notes: `Classified from region "${region.element_name ?? region.region_id}" with confidence ${region.confidence}.`,
  };
}

// ─── Public export ────────────────────────────────────────────────────────────

export function extractSlots(regions: ClassifiedRegion[]): SlotExtractionResult {
  const slot_definitions: SlotDefinition[] = [];
  const unresolved_regions: ClassifiedRegion[] = [];

  // Counters for sequential naming
  let headlineCount = 0;
  let bodyCount = 0;
  let ctaCount = 0;
  let imageCount = 0;
  let listCount = 0;

  for (const region of regions) {
    switch (region.slot_type) {
      case "text_headline": {
        headlineCount++;
        const slot_name =
          headlineCount === 1 ? "primary_headline" : "secondary_headline";
        slot_definitions.push(makeTextHeadlineDef(slot_name, region));
        break;
      }

      case "text_body": {
        bodyCount++;
        slot_definitions.push(
          makeTextBodyDef(`body_copy${ordinal(bodyCount)}`, region),
        );
        break;
      }

      case "cta": {
        ctaCount++;
        const slot_name =
          ctaCount === 1 ? "cta_primary" : "cta_secondary";
        slot_definitions.push(makeCtaDef(slot_name, region));
        break;
      }

      case "image": {
        imageCount++;
        // First image is "hero_image" only if there are headline regions (hero context)
        const hasHeadline = regions.some(
          (r) => r.slot_type === "text_headline",
        );
        const slot_name =
          imageCount === 1 && hasHeadline
            ? "hero_image"
            : `section_image${ordinal(imageCount)}`;
        slot_definitions.push(makeImageDef(slot_name, region));
        break;
      }

      case "list": {
        listCount++;
        const slot_name =
          listCount === 1 ? "features_list" : "benefits_list";
        slot_definitions.push(makeListDef(slot_name, region));
        break;
      }

      case "unclassified":
      default: {
        unresolved_regions.push(region);
        break;
      }
    }
  }

  return {
    slot_definitions,
    has_unresolved: unresolved_regions.length > 0,
    unresolved_regions,
  };
}
