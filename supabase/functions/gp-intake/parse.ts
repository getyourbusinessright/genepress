// Task 1 — Parse Service (Checkpoint 3a, parse pass)
// Walks the sanitized payload tree and produces raw regions for classification.

export type SanitizedPayload = {
  component_id: string;
  source_type: "figma" | "elementor_json";
  json_content: Record<string, unknown>;
};

export type RawRegion = {
  region_id: string;
  element_name: string | null;
  element_type: string | null;
  structural_position: string | null;
  font_size_rank: string | null; // 'largest' or null — Figma text layers only
  raw_json: object;
};

export type ParseResult = {
  component_id: string;
  source_type: "figma" | "elementor_json";
  raw_regions: RawRegion[];
  parse_error: string | null;
};

// ─── Elementor JSON path ─────────────────────────────────────────────────────

function parseElementor(
  component_id: string,
  json_content: Record<string, unknown>,
): ParseResult {
  const content = json_content.content;
  if (!Array.isArray(content) || content.length === 0) {
    return {
      component_id,
      source_type: "elementor_json",
      raw_regions: [],
      parse_error:
        "Elementor JSON content array is null, empty, or malformed — cannot parse",
    };
  }

  const raw_regions: RawRegion[] = [];
  let regionIndex = 0;

  function walkElementor(
    elements: unknown[],
    parentLength: number,
  ): void {
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!el || typeof el !== "object") continue;
      const element = el as Record<string, unknown>;

      const region_id = `region_${regionIndex++}`;

      // element_name: try in order — settings.title, settings._title,
      // widgetType_index, then fall back to element.id.
      let element_name: string | null = null;
      if (element.settings && typeof element.settings === "object") {
        const settings = element.settings as Record<string, unknown>;
        if (typeof settings.title === "string" && settings.title.trim()) {
          element_name = settings.title.trim();
        } else if (typeof settings._title === "string" && settings._title.trim()) {
          element_name = settings._title.trim();
        }
      }
      if (!element_name && typeof element.widgetType === "string" && element.widgetType) {
        element_name = `${element.widgetType}_${i}`;
      }
      if (!element_name && typeof element.id === "string" && element.id) {
        element_name = element.id;
      }

      // element_type: widgetType takes precedence; fall back to elType
      const element_type =
        typeof element.widgetType === "string" && element.widgetType
          ? element.widgetType
          : typeof element.elType === "string" && element.elType
          ? element.elType
          : null;

      // structural_position: first or last child of the current parent array
      let structural_position: string | null = null;
      if (i === 0) structural_position = "first";
      else if (i === parentLength - 1) structural_position = "last";

      raw_regions.push({
        region_id,
        element_name,
        element_type,
        structural_position,
        font_size_rank: null, // Elementor JSON has no reliable font-size metadata
        raw_json: element,
      });

      // Recurse into children
      if (Array.isArray(element.elements) && element.elements.length > 0) {
        walkElementor(element.elements, element.elements.length);
      }
    }
  }

  try {
    walkElementor(content, content.length);
  } catch (e) {
    return {
      component_id,
      source_type: "elementor_json",
      raw_regions: [],
      parse_error: `Failed to walk Elementor tree: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  if (raw_regions.length === 0) {
    return {
      component_id,
      source_type: "elementor_json",
      raw_regions: [],
      parse_error: "Elementor tree produced zero regions — tree may be empty",
    };
  }

  return { component_id, source_type: "elementor_json", raw_regions, parse_error: null };
}

// ─── Figma path ───────────────────────────────────────────────────────────────

type FigmaNode = Record<string, unknown>;

/** Returns every TEXT node directly inside `node.children` (non-recursive). */
function directTextChildren(node: FigmaNode): FigmaNode[] {
  if (!Array.isArray(node.children)) return [];
  return (node.children as FigmaNode[]).filter(
    (c) => c && typeof c === "object" && c.type === "TEXT",
  );
}

/** Returns true if the node looks interactive (COMPONENT, or name hints at button/cta). */
function isInteractive(node: FigmaNode): boolean {
  const type = typeof node.type === "string" ? node.type : "";
  const name = typeof node.name === "string" ? node.name.toLowerCase() : "";
  if (type === "COMPONENT") return true;
  return ["button", "btn", "cta", "action", "link"].some((k) =>
    name.includes(k)
  );
}

function parseFigma(
  component_id: string,
  json_content: Record<string, unknown>,
): ParseResult {
  const document = json_content.document;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return {
      component_id,
      source_type: "figma",
      raw_regions: [],
      parse_error: "Figma JSON is missing a valid document property",
    };
  }
  const doc = document as FigmaNode;
  if (!Array.isArray(doc.children)) {
    return {
      component_id,
      source_type: "figma",
      raw_regions: [],
      parse_error: "Figma document.children is not traversable",
    };
  }

  const raw_regions: RawRegion[] = [];
  let regionIndex = 0;

  function walkFigmaChildren(children: FigmaNode[]): void {
    // Pre-compute sibling context for structural_position and font_size_rank
    const frameLikeChildren = children.filter((c) =>
      c && typeof c === "object" &&
      ["FRAME", "COMPONENT", "GROUP"].includes(c.type as string)
    );

    // Indices (within `children`) of first text-containing child and last interactive child
    const firstTextChildIdx = children.findIndex((c) =>
      c && typeof c === "object" &&
      (["FRAME", "COMPONENT", "GROUP"].includes(c.type as string)) &&
      directTextChildren(c).length > 0
    );
    const lastInteractiveIdx = (() => {
      for (let i = children.length - 1; i >= 0; i--) {
        const c = children[i];
        if (c && typeof c === "object" && isInteractive(c)) return i;
      }
      return -1;
    })();

    // Largest font size among all direct TEXT nodes across all sibling frames
    let maxFontSize = 0;
    for (const child of children) {
      if (!child || typeof child !== "object") continue;
      for (const tn of directTextChildren(child)) {
        const style = tn.style as Record<string, unknown> | undefined;
        if (typeof style?.fontSize === "number" && style.fontSize > maxFontSize) {
          maxFontSize = style.fontSize as number;
        }
      }
    }

    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (!node || typeof node !== "object") continue;
      const nodeType = typeof node.type === "string" ? node.type : null;
      if (!nodeType || !["FRAME", "COMPONENT", "GROUP"].includes(nodeType)) {
        // Still recurse into non-region nodes so we don't miss nested frames
        if (Array.isArray(node.children)) {
          walkFigmaChildren(node.children as FigmaNode[]);
        }
        continue;
      }

      const region_id = `region_${regionIndex++}`;
      const element_name = typeof node.name === "string" ? node.name : null;

      // structural_position
      let structural_position: string | null = null;
      if (i === firstTextChildIdx) structural_position = "first";
      else if (i === lastInteractiveIdx && lastInteractiveIdx !== firstTextChildIdx) {
        structural_position = "last";
      }

      // font_size_rank: does this node contain the largest text among siblings?
      let font_size_rank: string | null = null;
      if (maxFontSize > 0) {
        const myTextNodes = directTextChildren(node);
        const myMaxFont = myTextNodes.reduce<number>((acc, tn) => {
          const style = tn.style as Record<string, unknown> | undefined;
          return typeof style?.fontSize === "number" && style.fontSize > acc
            ? (style.fontSize as number)
            : acc;
        }, 0);
        if (myMaxFont >= maxFontSize) font_size_rank = "largest";
      }

      raw_regions.push({
        region_id,
        element_name,
        element_type: nodeType,
        structural_position,
        font_size_rank,
        raw_json: node,
      });

      // Recurse into frame children
      if (Array.isArray(node.children) && node.children.length > 0) {
        walkFigmaChildren(node.children as FigmaNode[]);
      }
    }
  }

  try {
    walkFigmaChildren(doc.children as FigmaNode[]);
  } catch (e) {
    return {
      component_id,
      source_type: "figma",
      raw_regions: [],
      parse_error: `Failed to walk Figma tree: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  if (raw_regions.length === 0) {
    return {
      component_id,
      source_type: "figma",
      raw_regions: [],
      parse_error: "Figma tree produced zero regions — no FRAME, COMPONENT, or GROUP nodes found",
    };
  }

  return { component_id, source_type: "figma", raw_regions, parse_error: null };
}

// ─── Public export ────────────────────────────────────────────────────────────

export function parseSource(sanitizedPayload: SanitizedPayload): ParseResult {
  const { component_id, source_type, json_content } = sanitizedPayload;

  if (!json_content || typeof json_content !== "object") {
    return {
      component_id,
      source_type,
      raw_regions: [],
      parse_error: "Sanitized payload json_content is null or non-object",
    };
  }

  if (source_type === "elementor_json") {
    return parseElementor(component_id, json_content);
  }

  if (source_type === "figma") {
    return parseFigma(component_id, json_content);
  }

  return {
    component_id,
    source_type,
    raw_regions: [],
    parse_error: `Unknown source_type: ${source_type}`,
  };
}
