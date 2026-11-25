import { tagExamples } from './tags.examples';

/** An OpenAPI Example Object; `summary` is required so every example has a title in the UI. */
export type ApiExample = { summary: string; description?: string; value: unknown };

/**
 * Central registry of request/response examples shown in Swagger.
 *
 * One file per API area (`<area>.examples.ts`) exports a map of named examples; add it to `API_EXAMPLES` below.
 * Each entry is an OpenAPI Example Object: `summary`, optional `description`, and `value` (the JSON body).
 * Controllers reference examples by key through the decorators in `../api-examples.decorator.ts`, so the
 * example data stays out of the controllers and one example can be reused by several endpoints.
 */
export const API_EXAMPLES = {
  ...tagExamples,
} satisfies Record<string, ApiExample>;

export type ApiExampleKey = keyof typeof API_EXAMPLES;

export function examplesFor(keys: readonly ApiExampleKey[]): Record<string, ApiExample> {
  return Object.fromEntries(keys.map((key) => [key, API_EXAMPLES[key]]));
}
