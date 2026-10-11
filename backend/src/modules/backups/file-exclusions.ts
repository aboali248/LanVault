import { z } from "zod";

export const fileExtensionSchema = z.string()
  .trim()
  .regex(/^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/i, "Use a file extension such as .mp3 or .tar.gz")
  .max(32)
  .transform((extension) => extension.toLocaleLowerCase());

export const fileExtensionsSchema = z.array(fileExtensionSchema)
  .max(128)
  .refine((extensions) => new Set(extensions).size === extensions.length, "File extensions must be unique");

export function normalizeFileExtensions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const extensions = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLocaleLowerCase())
    .filter((item) => item.length <= 32 && /^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/i.test(item));
  return [...new Set(extensions)];
}

export function resolveExcludedExtensions(
  globalExcluded: unknown,
  deviceExcluded: unknown,
  deviceIncluded: unknown,
): string[] {
  const result = new Set(normalizeFileExtensions(globalExcluded));
  for (const extension of normalizeFileExtensions(deviceIncluded)) result.delete(extension);
  for (const extension of normalizeFileExtensions(deviceExcluded)) result.add(extension);
  return [...result].sort();
}

export function isExcludedFile(relativePath: string, excludedExtensions: ReadonlySet<string>): boolean {
  const normalizedPath = relativePath.toLocaleLowerCase();
  for (const extension of excludedExtensions) {
    if (normalizedPath.endsWith(extension)) return true;
  }
  return false;
}
