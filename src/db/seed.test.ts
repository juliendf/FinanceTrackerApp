/**
 * First-run seed.
 *
 * The regression this pins: the seed inserted the default provider with
 * `executeWrite`, which the SQLite authorizer refuses for `llm_providers` (that
 * row decides where an API key would be sent). On a fresh install the seed threw,
 * the gate never opened, and the app was unusable. Nothing covered the seed at all.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ select: vi.fn(), executeWrite: vi.fn(), invoke: vi.fn() }));

vi.mock("./client", () => ({
  getDb: async () => ({ select: db.select }),
  executeWrite: (...a: unknown[]) => db.executeWrite(...a),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => db.invoke(...a) }));
vi.mock("./repositories/profile", () => ({
  getProfile: async () => ({
    currency: "CHF",
    timezone: "Europe/Paris",
    date_format: "DD.MM.YYYY",
    ai_tone: "friendly",
    ai_verbosity: "concise",
    ai_expertise: "beginner",
  }),
}));

import { seedFirstRun, DEFAULT_PROVIDER, DEFAULT_PROVIDER_NAME } from "./seed";

/** An empty database: every COUNT(*) answers 0. */
function emptyDatabase() {
  db.select.mockImplementation(async (sql: string) => {
    if (sql.includes("COUNT(*)")) return [{ n: 0 }];
    return [];
  });
}

describe("seedFirstRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emptyDatabase();
    db.executeWrite.mockResolvedValue({ lastInsertId: 1, rowsAffected: 1 });
    db.invoke.mockResolvedValue(1);
  });

  it("creates the default provider through the provider command", async () => {
    // The generic write path refuses `llm_providers`; going through it made the
    // seed throw on every fresh install.
    await seedFirstRun();

    expect(db.invoke).toHaveBeenCalledWith("provider_save", {
      input: {
        id: null,
        name: DEFAULT_PROVIDER_NAME,
        base_url: DEFAULT_PROVIDER.baseUrl,
        model: DEFAULT_PROVIDER.model,
        provider_type: DEFAULT_PROVIDER.providerType,
        is_active: true,
        models: null,
        api_key: null,
      },
    });

    const providerWrites = db.executeWrite.mock.calls
      .map((call) => String(call[0]))
      .filter((sql) => sql.includes("llm_providers") || sql.includes("provider_models"));
    expect(providerWrites).toEqual([]);
  });

  it("does not touch the provider when one already exists", async () => {
    db.select.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM llm_providers")) return [{ n: 2 }];
      if (sql.includes("COUNT(*)")) return [{ n: 0 }];
      return [];
    });

    await seedFirstRun();
    expect(db.invoke).not.toHaveBeenCalledWith("provider_save", expect.anything());
  });

  it("still writes the settings, rates and profile directly", async () => {
    const counts = await seedFirstRun();

    expect(counts.provider).toBe(1);
    expect(counts.settings).toBeGreaterThan(0);
    expect(counts.rates).toBe(6);
    expect(counts.profile).toBe(1);
    // Those tables are ordinary data; the generic path is still theirs.
    expect(db.executeWrite).toHaveBeenCalled();
  });
});
