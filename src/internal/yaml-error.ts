/**
 * Narrow typing for the `yaml` package's error shape.
 * The package exposes line/column on a `YAMLParseError`; this keeps the
 * dependency's error type out of the public surface.
 */

export interface YamlErrorLike {
  message: string;
  linePos: { line: number; col: number }[];
}

export function isNumberedError(value: unknown): value is YamlErrorLike {
  if (!(value instanceof Error)) return false;
  const candidate = value as unknown as { linePos?: unknown };
  return Array.isArray(candidate.linePos);
}
