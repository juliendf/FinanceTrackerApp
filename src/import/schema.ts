/**
 * FinanceTracker backup format — v2 and v3.
 *
 * Envelope: `{ version, exported_at, data }`, produced by
 * `FinanceTracker/app/services/data_export.py` (`EXPORT_VERSION = 2`).
 *
 * What v2 actually contains, verified against a real export rather than the
 * planning documents: institutions, categories, tags, assets, snapshots,
 * exchange_rates, llm_providers, settings and **profile**. It does *not* contain
 * `Category.system_role`, memories, or goals as list entities (`financial_goals`
 * survives only as free text on the profile).
 *
 * v3 is the format the desktop app writes: v2 plus `system_role`, `memories`,
 * `goals`, and API keys omitted. See docs/IMPORT_FORMAT.md.
 */

import { z } from "zod";

const timestamp = z.string().optional().nullable();

export const institutionSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable().optional(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const categorySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  /** v3 only. */
  system_role: z.string().nullable().optional(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const tagSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  color: z.string().nullable().optional(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const assetSchema = z.object({
  id: z.number().int(),
  institution_id: z.number().int(),
  category_id: z.number().int(),
  currency: z.string(),
  product_name: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  code_nin: z.string().nullable().optional(),
  cost_charges: z.union([z.number(), z.string()]).nullable().optional(),
  interest_rate: z.union([z.number(), z.string()]).nullable().optional(),
  /** Convenience labels in the export; not stored directly. */
  institution_name: z.string().optional(),
  category_name: z.string().optional(),
  tag_names: z.array(z.string()).optional(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const snapshotSchema = z.object({
  id: z.number().int(),
  asset_id: z.number().int(),
  date: z.string(),
  amount: z.union([z.number(), z.string()]),
  created_at: timestamp,
  updated_at: timestamp,
});

export const exchangeRateSchema = z.object({
  id: z.number().int(),
  from_currency: z.string(),
  to_currency: z.string(),
  rate: z.union([z.number(), z.string()]),
  created_at: timestamp,
  updated_at: timestamp,
});

export const providerSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  base_url: z.string(),
  model: z.string(),
  provider_type: z.string().optional(),
  is_default: z.union([z.boolean(), z.number()]).optional(),
  is_active: z.union([z.boolean(), z.number()]).optional(),
  /** Plaintext in v2 — moved to the Keychain, never written to SQLite. */
  api_key: z.string().nullable().optional(),
  created_at: timestamp,
  updated_at: timestamp,
});

/** v3 addition: the models a provider offers, and whether chat may use them. */
export const providerModelSchema = z.object({
  provider_id: z.number().int(),
  model: z.string(),
  enabled: z.union([z.boolean(), z.number()]).optional(),
});

export const settingSchema = z.object({
  id: z.number().int().optional(),
  key: z.string(),
  value: z.string(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const profileSchema = z.object({
  default_currency: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  date_format: z.string().nullable().optional(),
  salary: z.union([z.number(), z.string()]).nullable().optional(),
  salary_currency: z.string().nullable().optional(),
  monthly_savings_target: z.union([z.number(), z.string()]).nullable().optional(),
  risk_profile: z.string().nullable().optional(),
  ai_tone: z.string().nullable().optional(),
  ai_verbosity: z.string().nullable().optional(),
  ai_expertise: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  /** Free text; there is no goals array in v2. */
  financial_goals: z.string().nullable().optional(),
  /** Not in the source app: a birth date, so advice can be age-aware. */
  birth_date: z.string().nullable().optional(),
  job_title: z.string().nullable().optional(),
  tax_residence: z.string().max(2).nullable().optional(),
  username: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

/** v3 additions. Optional so a v2 file parses with the same schema. */
export const memorySchema = z.object({
  id: z.number().int().optional(),
  category: z.string(),
  key: z.string(),
  content: z.string(),
  source: z.string().optional(),
  importance: z.number().int().optional(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const goalSchema = z.object({
  id: z.number().int().optional(),
  label: z.string(),
  target_amount: z.union([z.number(), z.string()]).nullable().optional(),
  target_date: z.string().nullable().optional(),
  priority: z.string().optional(),
  category: z.string().nullable().optional(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const backupDataSchema = z.object({
  institutions: z.array(institutionSchema).optional().default([]),
  categories: z.array(categorySchema).optional().default([]),
  tags: z.array(tagSchema).optional().default([]),
  assets: z.array(assetSchema).optional().default([]),
  snapshots: z.array(snapshotSchema).optional().default([]),
  exchange_rates: z.array(exchangeRateSchema).optional().default([]),
  llm_providers: z.array(providerSchema).optional().default([]),
  provider_models: z.array(providerModelSchema).optional().default([]),
  settings: z.array(settingSchema).optional().default([]),
  profile: profileSchema.optional().default({}),
  memories: z.array(memorySchema).optional().default([]),
  goals: z.array(goalSchema).optional().default([]),
});

export const backupEnvelopeSchema = z.object({
  version: z.number().int(),
  exported_at: z.string().optional().nullable(),
  data: backupDataSchema,
});

export type BackupData = z.infer<typeof backupDataSchema>;
export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

/** Highest version this build understands. */
export const SUPPORTED_VERSION = 3;
/** Lowest version accepted (v1 predates the envelope shape we rely on). */
export const MINIMUM_VERSION = 2;

export interface ParsedBackup {
  version: number;
  exportedAt: string | null;
  data: BackupData;
}

/**
 * Parse and validate a backup file.
 *
 * Throws with a message written for the user, not for a stack trace: the
 * wizard shows it verbatim.
 */
export function parseBackup(raw: string): ParsedBackup {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("This file is not valid JSON.");
  }

  if (typeof json !== "object" || json === null) {
    throw new Error("This file does not look like a FinanceTracker backup.");
  }

  const envelope = json as Record<string, unknown>;
  if (typeof envelope.version !== "number") {
    throw new Error(
      "This file has no backup version. Export it again from FinanceTracker > Settings > Data.",
    );
  }
  if (envelope.version > SUPPORTED_VERSION) {
    throw new Error(
      `This backup is version ${envelope.version}, and this app understands up to version ${SUPPORTED_VERSION}. Update the app first.`,
    );
  }
  if (envelope.version < MINIMUM_VERSION) {
    throw new Error(
      `This backup is version ${envelope.version}. Re-export it from FinanceTracker: the current export is version 2.`,
    );
  }

  const result = backupEnvelopeSchema.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.join(".") || "the file";
    throw new Error(
      `This backup is malformed at ${where}: ${first?.message ?? "invalid value"}.`,
    );
  }

  return {
    version: result.data.version,
    exportedAt: result.data.exported_at ?? null,
    data: result.data.data,
  };
}
