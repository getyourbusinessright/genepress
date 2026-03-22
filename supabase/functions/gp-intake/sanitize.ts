export type SanitizationResult = {
  result: "pass" | "fail" | "warnings";
  failures: string[];
  warnings: string[];
};

export function sanitizeElementorJson(
  content: Record<string, unknown>
): SanitizationResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  // Banned widget types — Pro and third-party widgets not allowed
  const BANNED_WIDGET_TYPES = [
    "form",
    "pro-gallery",
    "woocommerce-product",
    "woocommerce-cart",
    "lottie",
    "hotspot",
    "flip-box",
    "price-table",
    "price-list",
    "countdown",
    "table-of-contents",
    "nav-menu",
    "slides",
    "paypal-button",
    "stripe-button",
  ];

  // External asset domains not allowed
  const BANNED_ASSET_DOMAINS = [
    "preview.section.express",
    "sections.express",
    "divi.express",
  ];

  // Recursively walk all elements
  function walkElements(elements: unknown[]): void {
    for (const el of elements) {
      if (!el || typeof el !== "object") continue;
      const element = el as Record<string, unknown>;

      // Check widget type
      if (element.elType === "widget" && element.widgetType) {
        const widgetType = element.widgetType as string;
        if (BANNED_WIDGET_TYPES.includes(widgetType)) {
          failures.push(`banned_widget: ${widgetType}`);
        }
      }

      // Check for external asset references in settings
      if (element.settings && typeof element.settings === "object") {
        const settingsStr = JSON.stringify(element.settings);
        for (const domain of BANNED_ASSET_DOMAINS) {
          if (settingsStr.includes(domain)) {
            warnings.push(`external_asset_reference: ${domain}`);
          }
        }
      }

      // Recurse into children
      if (Array.isArray(element.elements)) {
        walkElements(element.elements);
      }
    }
  }

  const contentArray = content.content as unknown[];
  walkElements(contentArray);

  // Deduplicate warnings
  const uniqueWarnings = [...new Set(warnings)];
  const uniqueFailures = [...new Set(failures)];

  const result = uniqueFailures.length > 0
    ? "fail"
    : uniqueWarnings.length > 0
    ? "warnings"
    : "pass";

  return { result, failures: uniqueFailures, warnings: uniqueWarnings };
}
