/** Everything the backup export writes out. Typed SQL only. */

import { getDb } from "../client";

export interface ExportInstitution { id: number; name: string; description: string | null; created_at: string; updated_at: string }
export interface ExportCategory { id: number; name: string; description: string | null; color: string | null; system_role: string | null; created_at: string; updated_at: string }
export interface ExportTag { id: number; name: string; color: string | null; created_at: string; updated_at: string }
export interface ExportAsset {
  id: number; institution_id: number; category_id: number; currency: string; product_name: string;
  name: string | null; description: string | null; notes: string | null; code_nin: string | null;
  cost_charges: string | null; interest_rate: string | null; created_at: string; updated_at: string;
  institution_name: string | null; category_name: string | null; tag_names: string[];
}
export interface ExportSnapshot {
  id: number; asset_id: number; date: string; amount_minor: number; created_at: string; updated_at: string;
  asset_institution: string | null; asset_product: string | null; asset_category: string | null; asset_currency: string | null;
}
export interface ExportRate { id: number; from_currency: string; to_currency: string; rate: string; created_at: string; updated_at: string }
export interface ExportProvider {
  id: number; name: string; base_url: string; model: string; provider_type: string;
  keychain_ref: string | null; is_default: number; is_active: number; created_at: string; updated_at: string;
}
export interface ExportProviderModel { provider_id: number; model: string; enabled: number }
export interface ExportSetting { id: number; key: string; value: string; created_at: string; updated_at: string }
export interface ExportProfile {
  first_name: string | null; last_name: string | null; job_title: string | null; financial_goals: string | null;
  birth_date: string | null;
  currency: string; timezone: string; date_format: string;
  salary_minor: number | null; monthly_savings_target_minor: number | null;
  risk_profile: string | null; ai_tone: string; ai_verbosity: string; ai_expertise: string;
}
export interface ExportMemory { id: number; category: string; key: string; content: string; source: string; importance: number; created_at: string; updated_at: string }
export interface ExportGoal { id: number; label: string; target_amount_minor: number | null; target_date: string | null; priority: string; category: string | null; created_at: string; updated_at: string }

export interface ExportRows {
  institutions: ExportInstitution[];
  categories: ExportCategory[];
  tags: ExportTag[];
  assets: ExportAsset[];
  snapshots: ExportSnapshot[];
  exchange_rates: ExportRate[];
  llm_providers: ExportProvider[];
  provider_models: ExportProviderModel[];
  settings: ExportSetting[];
  profile: ExportProfile | null;
  memories: ExportMemory[];
  goals: ExportGoal[];
}

export async function readExportRows(): Promise<ExportRows> {
  const db = await getDb();
  const [institutions, categories, tags, assets, tagLinks, snapshots, exchange_rates, llm_providers, provider_models, settings, profile, memories, goals] =
    await Promise.all([
      db.select<ExportInstitution[]>(`SELECT id, name, description, created_at, updated_at FROM institutions ORDER BY id`),
      db.select<ExportCategory[]>(`SELECT id, name, description, color, system_role, created_at, updated_at FROM categories ORDER BY id`),
      db.select<ExportTag[]>(`SELECT id, name, color, created_at, updated_at FROM tags ORDER BY id`),
      db.select<Omit<ExportAsset, "tag_names">[]>(
        `SELECT a.id, a.institution_id, a.category_id, a.currency, a.product_name, a.name,
                a.description, a.notes, a.code_nin, a.cost_charges, a.interest_rate,
                a.created_at, a.updated_at,
                i.name AS institution_name, c.name AS category_name
           FROM assets a
           JOIN institutions i ON i.id = a.institution_id
           JOIN categories c   ON c.id = a.category_id
          ORDER BY a.id`,
      ),
      db.select<{ asset_id: number; name: string }[]>(
        `SELECT at.asset_id, t.name FROM asset_tags at JOIN tags t ON t.id = at.tag_id ORDER BY at.asset_id, t.name`,
      ),
      db.select<ExportSnapshot[]>(
        `SELECT s.id, s.asset_id, s.date, s.amount_minor, s.created_at, s.updated_at,
                i.name AS asset_institution, a.product_name AS asset_product,
                c.name AS asset_category, a.currency AS asset_currency
           FROM snapshots s
           JOIN assets a       ON a.id = s.asset_id
           JOIN institutions i ON i.id = a.institution_id
           JOIN categories c   ON c.id = a.category_id
          ORDER BY s.id`,
      ),
      db.select<ExportRate[]>(`SELECT id, from_currency, to_currency, rate, created_at, updated_at FROM exchange_rates ORDER BY id`),
      db.select<ExportProvider[]>(
        `SELECT id, name, base_url, model, provider_type, keychain_ref, is_default, is_active, created_at, updated_at
           FROM llm_providers ORDER BY id`,
      ),
      db.select<ExportProviderModel[]>(
        `SELECT provider_id, model, enabled FROM provider_models ORDER BY provider_id, model`,
      ),
      db.select<ExportSetting[]>(`SELECT id, key, value, created_at, updated_at FROM settings ORDER BY key`),
      db
        .select<ExportProfile[]>(
          `SELECT first_name, last_name, job_title, financial_goals, birth_date, currency, timezone,
                  date_format, salary_minor, monthly_savings_target_minor, risk_profile, ai_tone,
                  ai_verbosity, ai_expertise
             FROM profile LIMIT 1`,
        )
        .then((rows) => rows[0] ?? null),
      db.select<ExportMemory[]>(
        `SELECT id, category, key, content, source, importance, created_at, updated_at FROM user_memories ORDER BY id`,
      ),
      db.select<ExportGoal[]>(
        `SELECT id, label, target_amount_minor, target_date, priority, category, created_at, updated_at FROM user_goals ORDER BY id`,
      ),
    ]);

  return {
    institutions,
    categories,
    tags,
    assets: assets.map((asset) => ({
      ...asset,
      tag_names: tagLinks.filter((link) => link.asset_id === asset.id).map((link) => link.name),
    })),
    snapshots,
    exchange_rates,
    llm_providers,
    provider_models,
    settings,
    profile,
    memories,
    goals,
  };
}
