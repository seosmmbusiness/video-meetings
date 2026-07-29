/**
 * class-transformer `@Transform` callback that trims and lowercases email
 * input so lookups/uniqueness checks aren't fooled by casing or whitespace.
 * @param params - The transform callback params; only `value` is used.
 * @param params.value - The raw field value being transformed.
 * @returns The normalized email, or the original value if it isn't a string.
 */
export function normalizeEmail({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}
