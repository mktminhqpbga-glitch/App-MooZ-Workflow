import { translate } from "@toonflow/i18n/vue";

const displayFields = new Set(["title", "label", "placeholder", "description", "help", "tooltip", "emptyText", "noDataText", "activeText", "inactiveText"]);

/** Localize provider form labels while preserving field names, values and prompts. */
export function translateUiRules<T>(rules: T): T {
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      displayFields.has(key) && typeof item === "string" ? translate(item) : key === "value" ? item : visit(item),
    ]));
  }
  return visit(rules) as T;
}
