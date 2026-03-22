// Task 2 — Heuristic Classification (Checkpoint 3a)
// Deterministic rule-based classifier. No AI involved. First match wins.

import type { RawRegion } from "./parse.ts";

export type SlotType =
  | "text_headline"
  | "text_body"
  | "cta"
  | "image"
  | "list"
  | "unclassified";

export type Confidence = "high" | "medium" | "low";

export type ClassifiedRegion = RawRegion & {
  slot_type: SlotType;
  confidence: Confidence;
};

/** Element types that suggest interactivity (used by Rule 12). */
const INTERACTIVE_TYPE_HINTS = ["button", "btn", "link", "anchor", "interactive"];

function nameContains(name: string | null, keywords: string[]): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function typeEquals(type: string | null, value: string): boolean {
  return (type ?? "").toLowerCase() === value;
}

function typeIsInteractive(type: string | null): boolean {
  if (!type) return false;
  const lower = type.toLowerCase();
  return INTERACTIVE_TYPE_HINTS.some((k) => lower.includes(k));
}

export function classifyHeuristic(regions: RawRegion[]): ClassifiedRegion[] {
  return regions.map((region): ClassifiedRegion => {
    const { element_name, element_type, structural_position, font_size_rank } =
      region;

    // ── Name-based rules (HIGH confidence) ───────────────────────────────────

    // Rule 1: headline names
    if (nameContains(element_name, ["headline", "title", "heading", "h1", "h2"])) {
      return { ...region, slot_type: "text_headline", confidence: "high" };
    }

    // Rule 2: body names
    if (
      nameContains(element_name, ["body", "copy", "description", "paragraph", "text"])
    ) {
      return { ...region, slot_type: "text_body", confidence: "high" };
    }

    // Rule 3: cta names
    if (nameContains(element_name, ["cta", "button", "btn", "action"])) {
      return { ...region, slot_type: "cta", confidence: "high" };
    }

    // Rule 4: image names
    if (
      nameContains(element_name, [
        "image",
        "photo",
        "img",
        "picture",
        "visual",
        "thumbnail",
      ])
    ) {
      return { ...region, slot_type: "image", confidence: "high" };
    }

    // Rule 5: list names
    if (
      nameContains(element_name, ["list", "items", "features", "benefits", "bullets"])
    ) {
      return { ...region, slot_type: "list", confidence: "high" };
    }

    // ── Element-type rules — Elementor widget types (HIGH confidence) ─────────

    // Rule 6: Elementor heading widget
    if (typeEquals(element_type, "heading")) {
      return { ...region, slot_type: "text_headline", confidence: "high" };
    }

    // Rule 7: Elementor text widgets
    if (typeEquals(element_type, "text-editor") || typeEquals(element_type, "text")) {
      return { ...region, slot_type: "text_body", confidence: "high" };
    }

    // Rule 8: Elementor button widget
    if (typeEquals(element_type, "button")) {
      return { ...region, slot_type: "cta", confidence: "high" };
    }

    // Rule 9: Elementor image widget
    if (typeEquals(element_type, "image")) {
      return { ...region, slot_type: "image", confidence: "high" };
    }

    // Rule 10: Elementor icon-list widget
    if (typeEquals(element_type, "icon-list")) {
      return { ...region, slot_type: "list", confidence: "high" };
    }

    // ── Structural / positional rules (MEDIUM confidence) ─────────────────────

    // Rule 11: first position + largest font → headline
    if (structural_position === "first" && font_size_rank === "largest") {
      return { ...region, slot_type: "text_headline", confidence: "medium" };
    }

    // Rule 12: last position + interactive element type → cta
    if (structural_position === "last" && typeIsInteractive(element_type)) {
      return { ...region, slot_type: "cta", confidence: "medium" };
    }

    // Rule 13: no match → unclassified (LOW — triggers AI pass)
    return { ...region, slot_type: "unclassified", confidence: "low" };
  });
}
