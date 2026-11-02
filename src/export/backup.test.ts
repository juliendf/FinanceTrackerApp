import { describe, expect, it } from "vitest";
import type { ExportRows } from "../db/repositories/export";
import { backupFileName, backupJson, buildBackup, EXPORT_VERSION } from "./backup";

const rows: ExportRows = {
  institutions: [{ id: 1, name: "UBS", description: null, created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00" }],
  categories: [{ id: 1, name: "Cash", description: null, color: null, system_role: "cash", created_at: "a", updated_at: "b" }],
  tags: [{ id: 1, name: "Liquid", color: "#fff", created_at: "a", updated_at: "b" }],
  assets: [{
    id: 1, institution_id: 1, category_id: 1, currency: "CHF", product_name: "Compte", name: null,
    description: null, notes: null, code_nin: null, cost_charges: null, interest_rate: null,
    created_at: "a", updated_at: "b", institution_name: "UBS", category_name: "Cash", tag_names: ["Liquid"],
  }],
  snapshots: [{
    id: 1, asset_id: 1, date: "2026-01-31", amount_minor: 123456, created_at: "a", updated_at: "b",
    asset_institution: "UBS", asset_product: "Compte", asset_category: "Cash", asset_currency: "CHF",
  }],
  exchange_rates: [{ id: 1, from_currency: "EUR", to_currency: "CHF", rate: "0.9319", created_at: "a", updated_at: "b" }],
  llm_providers: [{
    id: 2, name: "Gemini", base_url: "https://example.test/v1", model: "gemini-2.0-flash", provider_type: "openai",
    keychain_ref: "provider:2", is_default: 1, is_active: 1, created_at: "a", updated_at: "b",
  }],
  provider_models: [
    { provider_id: 2, model: "gemini-2.0-flash", enabled: 1 },
    { provider_id: 2, model: "gemini-2.5-pro", enabled: 0 },
  ],
  settings: [{ id: 1, key: "base_currency", value: "CHF", created_at: "a", updated_at: "b" }],
  profile: {
    first_name: "Julien", last_name: null, job_title: "Senior SRE", financial_goals: "Retire comfortably.",
    birth_date: "1990-03-15", tax_residence: "CH",
    monthly_expenses_minor: 380000, dependants_count: 0, dependant_ages: null,
    employment_status: "employed",
    currency: "CHF", timezone: "Europe/Zurich", date_format: "%d.%m.%Y",
    salary_minor: 500000, monthly_savings_target_minor: null, risk_profile: null,
    ai_tone: "encouraging", ai_verbosity: "balanced", ai_expertise: "intermediate",
  },
  memories: [{ id: 1, category: "goal", key: "k", content: "c", source: "manual", importance: 3, created_at: "a", updated_at: "b" }],
  goals: [{ id: 1, label: "House", target_amount_minor: 100000000, target_date: null, priority: "high", category: null, created_at: "a", updated_at: "b" }],
};

describe("buildBackup", () => {
  it("writes version 3 with amounts as numbers", () => {
    const envelope = buildBackup(rows, "2026-10-31T10:00:00");
    expect(envelope.version).toBe(EXPORT_VERSION);
    expect((envelope.data.snapshots as Array<{ amount: number }>)[0].amount).toBe(1234.56);
    expect((envelope.data.profile as { salary: number }).salary).toBe(5000);
    expect((envelope.data.goals as Array<{ target_amount: number }>)[0].target_amount).toBe(1000000);
  });

  it("never writes an API key or a Keychain reference", () => {
    const json = backupJson(buildBackup(rows, "2026-10-31T10:00:00"));
    expect(json).not.toContain("provider:2");
    expect(json).not.toContain("keychain_ref");
    expect(json).toContain('"api_key": null');
    expect(json).not.toMatch(/"api_key":\s*"[^n]/);
  });

  it("keeps the roles the Résumé needs and the denormalised labels", () => {
    const data = buildBackup(rows, "x").data;
    expect((data.categories as Array<{ system_role: string }>)[0].system_role).toBe("cash");
    expect((data.assets as Array<{ tag_names: string[] }>)[0].tag_names).toEqual(["Liquid"]);
  });

  it("carries the enabled model list with the provider", () => {
    const data = buildBackup(rows, "x").data;
    expect(data.provider_models).toEqual([
      { provider_id: 2, model: "gemini-2.0-flash", enabled: true },
      { provider_id: 2, model: "gemini-2.5-pro", enabled: false },
    ]);
  });

  it("leaves out entities that were not selected", () => {
    const data = buildBackup(rows, "x", ["institutions", "settings"]).data;
    expect(Object.keys(data).sort()).toEqual(["institutions", "settings"]);
  });

  it("names the file with a timestamp", () => {
    expect(backupFileName(new Date(2026, 9, 26, 20, 58, 43))).toBe("finance_tracker_data_20261026_205843.json");
  });
});
