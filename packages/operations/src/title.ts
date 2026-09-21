import { createHash } from "node:crypto";

export interface TitleValidationResult {
  ok: boolean;
  issues: string[];
}

export function canonicalTitle(value: string): string {
  return value.normalize("NFC");
}

export function canonicalDigest(value: string): string {
  return createHash("sha256").update(canonicalTitle(value), "utf8").digest("hex");
}

export function validateTitle(value: string): TitleValidationResult {
  const normalized = canonicalTitle(value);
  const issues: string[] = [];
  const length = Array.from(normalized).length;
  if (length < 1) issues.push("title_empty");
  if (length > 140) issues.push("title_too_long");
  if (normalized !== normalized.trim()) issues.push("title_outer_whitespace");
  if (!/^[\p{L}\p{Nd}\p{P}\p{Sm}\p{Zs}™©®]*$/u.test(normalized)) {
    issues.push("title_unsupported_character");
  }
  for (const limited of ["%", ":", "&", "+"]) {
    if (normalized.split(limited).length - 1 > 1) issues.push("title_repeated_limited_character");
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}
