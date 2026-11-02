/**
 * Validation for the three reference entities.
 *
 * Note the colour asymmetry, which is deliberate:
 *   * a category colour is `^#[0-9A-Fa-f]{6}$` — exactly six digits;
 *   * a tag colour is `^#(?:[0-9a-fA-F]{3}){1,2}$` — three or six.
 *
 * Uniqueness is case-sensitive: names are matched exactly on a BINARY
 * collation. The database's UNIQUE constraint is the final arbiter, and the UI
 * also maps a constraint failure back onto the field.
 */

import { z } from "zod";
import { SYSTEM_ROLE_CHOICES } from "./systemCategory";

/** `^#[0-9A-Fa-f]{6}$` */
export const HEX_6 = /^#[0-9A-Fa-f]{6}$/;
/** `^#(?:[0-9a-fA-F]{3}){1,2}$` */
export const HEX_3_OR_6 = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

const SYSTEM_ROLE_VALUES = SYSTEM_ROLE_CHOICES.map((choice) => choice.value) as [
  string,
  ...string[],
];

export const institutionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Institution name is required")
    .max(100, "Name must be between 1 and 100 characters"),
  description: z
    .string()
    .trim()
    .max(500, "Description cannot exceed 500 characters"),
});

export const categorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Category name is required")
    .max(50, "Name must be between 1 and 50 characters"),
  description: z
    .string()
    .trim()
    .max(500, "Description cannot exceed 500 characters"),
  color: z
    .string()
    .trim()
    .refine((value) => value === "" || HEX_6.test(value), {
      message: "Color must be a valid hex code (e.g., #FF0000)",
    }),
  system_role: z.union([z.enum(SYSTEM_ROLE_VALUES), z.literal("")]),
});

export const tagSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Tag name is required")
    .max(50, "Name must be at most 50 characters"),
  color: z
    .string()
    .trim()
    .refine((value) => value === "" || HEX_3_OR_6.test(value), {
      message: "Must be valid hex code",
    }),
});

export type InstitutionInput = z.infer<typeof institutionSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type TagInput = z.infer<typeof tagSchema>;

/** `#007bff`, the default applied when a category is created from the form. */
export const DEFAULT_CATEGORY_COLOR = "#007bff";

/**
 * `#6c757d`, the default when no colour is given at all: quick-add creates a
 * category without one, so it gets this rather than the form's.
 */
export const QUICK_ADD_CATEGORY_COLOR = "#6c757d";

/**
 * Map a SQLite constraint failure onto a field message.
 *
 * `tauri-plugin-sql` surfaces the raw error text, so matching on it is the only
 * option; the fallback keeps an unknown failure visible instead of silent.
 */
export function uniqueErrorFor(error: unknown, field: "name"): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!/UNIQUE constraint failed/i.test(message)) return null;
  if (!/\.name\b/.test(message)) return null;
  if (/institutions\.name/.test(message)) return "An institution with this name already exists.";
  if (/categories\.name/.test(message)) return "A category with this name already exists.";
  if (/tags\.name/.test(message)) return "Tag name must be unique.";
  void field;
  return "That name is already taken.";
}

/** Human label for a system role, or "" when unset. */
export function systemRoleLabel(role: string | null | undefined): string {
  if (!role) return "";
  return SYSTEM_ROLE_CHOICES.find((choice) => choice.value === role)?.label ?? role;
}
