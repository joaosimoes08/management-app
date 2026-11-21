import { BadRequestException } from '@nestjs/common';

/**
 * Parses a comma-separated query filter against a Prisma enum. Values are trimmed and upper-cased;
 * an empty filter returns []. Any unknown value is a 400 `<CODE>` instead of a Prisma 500.
 */
export function parseEnumFilter<E extends Record<string, string>>(raw: string | undefined | null, values: E, field: string, code: string): E[keyof E][] {
  const allowed = Object.values(values) as E[keyof E][];
  const parts = String(raw ?? '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
  const invalid = parts.filter((value) => !(allowed as string[]).includes(value));
  if (invalid.length) throw new BadRequestException({ code, message: `${field} inválido: ${invalid.join(', ')}. Valores aceites: ${allowed.join(', ')}.` });
  return [...new Set(parts)] as E[keyof E][];
}

/** Prisma `where` fragment for a parsed enum filter: nothing, one value, or `in`. */
export function enumWhere<T>(values: T[]): T | { in: T[] } | undefined {
  if (!values.length) return undefined;
  return values.length === 1 ? values[0] : { in: values };
}
