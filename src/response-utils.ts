/**
 * Response utilities for reducing token usage in LLM-facing tool responses.
 *
 * - compactJson: strips null/empty fields and removes indentation
 * - fieldsToSummary: converts FormField[] to a compact text summary
 * - randomDelay: human-like typing delay (50-200ms)
 */

interface FormFieldLike {
  type: string;
  label: string;
  name?: string;
  value?: string;
  options?: string[];
  required?: boolean;
  checked?: boolean;
}

/**
 * Human-like typing delay: random value between 50–200ms.
 * Shared across all tools that use pressSequentially.
 */
export function randomDelay(): number {
  return Math.floor(Math.random() * (200 - 50 + 1)) + 50;
}

/**
 * Serialize an object to JSON, stripping keys with null, undefined,
 * empty string, or empty array values. No indentation.
 */
export function compactJson(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value === null || value === undefined) return undefined;
    if (value === "") return undefined;
    if (Array.isArray(value) && value.length === 0) return undefined;
    return value;
  });
}

/**
 * Convert a FormField array into a compact, human-readable summary.
 *
 * Example output:
 *   [text] "First name" (required) value="John"
 *   [select] "Country" (required) options=["US","UK","CA"]
 *   [checkbox] "Follow company" checked=true
 */
export function fieldsToSummary(fields: FormFieldLike[]): string {
  if (fields.length === 0) return "(no fields)";

  return fields
    .map((f) => {
      const parts: string[] = [`[${f.type}] "${f.label}"`];

      if (f.required) parts.push("(required)");

      if (f.value) parts.push(`value="${f.value}"`);

      if (f.options && f.options.length > 0) {
        parts.push(`options=${JSON.stringify(f.options)}`);
      }

      if (f.checked !== undefined) {
        parts.push(`checked=${f.checked}`);
      }

      return parts.join(" ");
    })
    .join("\n");
}
