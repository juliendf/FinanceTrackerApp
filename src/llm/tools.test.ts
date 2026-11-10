/**
 * Tool executors against mocked repositories.
 *
 * The important assertion in this file is negative: no tool ever writes a
 * snapshot or a memory. Write tools only stage a pending action.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  listAssets: vi.fn(),
  listAllSnapshotPoints: vi.fn(),
  latestSnapshotForAsset: vi.fn(),
  snapshotExists: vi.fn(),
  getSnapshotOn: vi.fn(),
  createSnapshot: vi.fn(),
  updateSnapshot: vi.fn(),
  createPendingAction: vi.fn(),
  listPendingActions: vi.fn(),
  listRecentMessages: vi.fn(),
  listFacts: vi.fn(),
  listAssetCurrencies: vi.fn(),
  listExchangeRates: vi.fn(),
  getAllSettings: vi.fn(),
  listTopMemories: vi.fn(),
  createMemory: vi.fn(),
  listAllHoldings: vi.fn(),
}));

vi.mock("../db/repositories/assets", () => ({ listAssets: () => repo.listAssets() }));
vi.mock("../db/repositories/snapshots", () => ({
  listAllSnapshotPoints: () => repo.listAllSnapshotPoints(),
  latestSnapshotForAsset: () => repo.latestSnapshotForAsset(),
  snapshotExists: (...a: unknown[]) => repo.snapshotExists(...a),
  getSnapshotOn: (...a: unknown[]) => repo.getSnapshotOn(...a),
  createSnapshot: (...a: unknown[]) => repo.createSnapshot(...a),
  updateSnapshot: (...a: unknown[]) => repo.updateSnapshot(...a),
}));
vi.mock("../db/repositories/chat", () => ({
  createPendingAction: (...a: unknown[]) => repo.createPendingAction(...a),
  listPendingActions: () => repo.listPendingActions(),
  listRecentMessages: () => repo.listRecentMessages(),
}));
vi.mock("../db/repositories/dashboard", () => ({
  listFacts: () => repo.listFacts(),
  listAssetCurrencies: () => repo.listAssetCurrencies(),
}));
vi.mock("../db/repositories/exchangeRates", () => ({ listExchangeRates: () => repo.listExchangeRates() }));
vi.mock("../db/repositories/settings", () => ({ getAllSettings: () => repo.getAllSettings() }));
vi.mock("../db/repositories/profile", () => ({ listTopMemories: () => repo.listTopMemories() }));
vi.mock("../db/repositories/holdings", () => ({ listAllHoldings: () => repo.listAllHoldings() }));

import { executeTool, TOOL_DEFINITIONS } from "./tools";

const asset = (id: number, over: Record<string, unknown> = {}) => ({
  id, institution_id: 1, category_id: 1, currency: "CHF", product_name: `P${id}`, name: null,
  description: null, notes: null, code_nin: null, cost_charges: null, interest_rate: null,
  created_at: "", updated_at: "", institution_name: "UBS", category_name: "Cash",
  category_color: null, latest_amount_minor: 100000, latest_date: "2026-09-30", tags: [], ...over,
});

const fact = (asset_id: number, date: string, amount_minor: number, over: Record<string, unknown> = {}) => ({
  asset_id, date, amount_minor, currency: "CHF", institution_name: "UBS",
  category_name: "Cash", product_name: `P${asset_id}`, system_role: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  repo.listAssets.mockResolvedValue([asset(1), asset(2, { currency: "EUR", institution_name: "Boursorama", tags: [{ id: 1, name: "Liquid", color: null }] })]);
  repo.listAllSnapshotPoints.mockResolvedValue([
    { asset_id: 1, date: "2026-01-31", amount_minor: 80000, currency: "CHF" },
    { asset_id: 1, date: "2026-09-30", amount_minor: 100000, currency: "CHF" },
  ]);
  repo.listFacts.mockResolvedValue([
    fact(1, "2026-09-30", 100000),
    fact(2, "2026-09-30", 50000, { currency: "EUR", institution_name: "Boursorama" }),
  ]);
  repo.listAssetCurrencies.mockResolvedValue(["CHF", "EUR"]);
  repo.listExchangeRates.mockResolvedValue([{ from_currency: "EUR", to_currency: "CHF", rate: "0.95" }]);
  repo.getAllSettings.mockResolvedValue({ base_currency: "CHF" });
  repo.latestSnapshotForAsset.mockResolvedValue(null);
  repo.snapshotExists.mockResolvedValue(false);
  repo.getSnapshotOn.mockResolvedValue(null);
  repo.createPendingAction.mockResolvedValue(11);
  repo.listAllHoldings.mockResolvedValue([]);
});

describe("tool definitions", () => {
  it("ships the eight tools the prompt describes", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.function.name)).toEqual([
      "get_portfolio_summary",
      "list_assets",
      "get_asset_details",
      "get_asset_history",
      "get_allocation",
      "calculate",
      "propose_snapshot",
      "remember_fact",
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.type).toBe("function");
      expect(tool.function.parameters).toHaveProperty("type", "object");
    }
  });
});

describe("read tools", () => {
  const ctx = { conversationId: 1, today: "2026-10-31" };

  it("summarises the portfolio in the base currency", async () => {
    const { result } = await executeTool("get_portfolio_summary", {}, ctx);
    // 1000 CHF + 500 EUR * 0.95
    expect(result).toMatchObject({
      total_value_base: 1475,
      // The display string the model is told to copy instead of formatting itself.
      total_value_display: "1,475.00 CHF",
      base_currency: "CHF",
      asset_count: 2,
      last_update_date: "2026-09-30",
    });
  });

  it("hands the model a display string for every money field", async () => {
    // A CHF portfolio came back from a small model as "₫ 578’865": the tool only
    // gave a number and a code, so it invented the rest.
    const summary = await executeTool("get_portfolio_summary", {}, ctx);
    expect((summary.result as { total_value_display: string }).total_value_display).toBe("1,475.00 CHF");

    const allocation = await executeTool("get_allocation", { dimension: "currency" }, ctx);
    expect((allocation.result as { total_base_display: string }).total_base_display).toBe("1,475.00 CHF");

    const assets = await executeTool("list_assets", {}, ctx);
    const rows = assets.result as Array<{ latest_amount_display: string }>;
    expect(rows.map((row) => row.latest_amount_display)).toEqual(["€1,000.00", "1,000.00 CHF"]);

    const details = await executeTool("get_asset_details", { asset_id: 1 }, ctx);
    expect((details.result as { latest_amount_display: string }).latest_amount_display).toBe("1,000.00 CHF");
  });

  it("lists assets with their fields, sorted by institution then product", async () => {
    const { result } = await executeTool("list_assets", {}, ctx);
    expect(result).toEqual([
      { asset_id: 2, name: "Boursorama - P2 (Cash)", institution: "Boursorama", category: "Cash", currency: "EUR", latest_amount: 1000, latest_amount_display: "€1,000.00", latest_date: "2026-09-30" },
      { asset_id: 1, name: "UBS - P1 (Cash)", institution: "UBS", category: "Cash", currency: "CHF", latest_amount: 1000, latest_amount_display: "1,000.00 CHF", latest_date: "2026-09-30" },
    ]);
  });

  it("sorts before it caps, so a named asset is not silently dropped", async () => {
    // 60 assets, sorted by product: the cap must keep the first 50 by name, not
    // whichever 50 the repository happened to return.
    const many = Array.from({ length: 60 }, (_, index) => asset(index + 1, { product_name: `P${String(index).padStart(2, "0")}` }));
    repo.listAssets.mockResolvedValue(many);
    const { result } = await executeTool("list_assets", {}, ctx);
    const rows = result as Array<{ asset_id: number }>;
    expect(rows).toHaveLength(50);
    // P00 … P49 by name, i.e. ids 1…50, not the repository's insertion order.
    expect(rows.map((row) => row.asset_id)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("filters by institution, category and tag", async () => {
    const byInstitution = await executeTool("list_assets", { institution_name: "bours" }, ctx);
    expect((byInstitution.result as unknown[]).length).toBe(1);
    const byTag = await executeTool("list_assets", { tag_name: "liqu" }, ctx);
    expect((byTag.result as unknown[]).length).toBe(1);
  });

  it("details carry the holdings when there are any", async () => {
    repo.listAllHoldings.mockResolvedValue([
      { id: 1, asset_id: 1, isin: "FR0000120073", label: null, quantity: "12.5", price: null },
    ]);
    const { result } = await executeTool("get_asset_details", { asset_id: 1 }, ctx);
    expect((result as { holdings: unknown }).holdings).toEqual([
      { isin: "FR0000120073", quantity: "12.5" },
    ]);
  });

  it("splits the asset's value across the priced lines", async () => {
    repo.listAllHoldings.mockResolvedValue([
      { id: 1, asset_id: 1, isin: "FR0000120073", label: "World", quantity: "10", price: "20" },
      { id: 2, asset_id: 1, isin: "IE00B4L5Y983", label: null, quantity: "5", price: "40" },
    ]);
    const { result } = await executeTool("get_asset_details", { asset_id: 1 }, ctx);
    const details = result as {
      holdings: Array<Record<string, unknown>>;
      holdings_value: number;
      holdings_basis: string;
    };
    // 200 and 200 of raw price × quantity: equal weights, so half of the asset's
    // 1,000 each. The snapshot is the total; the prices only set the split.
    expect(details.holdings_value).toBe(1000);
    expect(details.holdings_basis).toMatch(/split/);
    expect(details.holdings[0]).toMatchObject({ isin: "FR0000120073", name: "World", price: 20, value: 500, share_pct: 50 });
    expect(details.holdings[1]).toMatchObject({ isin: "IE00B4L5Y983", value: 500, share_pct: 50 });
  });

  it("reports no total when a line has no price", async () => {
    repo.listAllHoldings.mockResolvedValue([
      { id: 1, asset_id: 1, isin: "FR0000120073", label: null, quantity: "10", price: "20" },
      { id: 2, asset_id: 1, isin: "IE00B4L5Y983", label: null, quantity: "5", price: null },
    ]);
    const { result } = await executeTool("get_asset_details", { asset_id: 1 }, ctx);
    const details = result as { holdings_value?: number };
    expect(details.holdings_value).toBeUndefined();
  });

  it("details include the 30/90-day change", async () => {
    const { result } = await executeTool("get_asset_details", { asset_id: 1 }, ctx);
    expect(result).toMatchObject({ asset_id: 1, latest_amount: 1000, latest_date: "2026-09-30" });
    // Nothing is left in the 30-day window (since 2026-10-01), and the 90-day
    // window only holds the latest point itself, so both changes are flat/null.
    expect((result as { change_30d_pct: number | null }).change_30d_pct).toBeNull();
    expect((result as { change_90d_pct: number | null }).change_90d_pct).toBe(0);
  });

  it("reports a drop to zero instead of hiding it", async () => {
    // first snapshot 800, latest 0: a real -100 %, not "no change".
    repo.listAllSnapshotPoints.mockResolvedValue([
      { asset_id: 1, date: "2026-09-01", amount_minor: 80000, currency: "CHF" },
      { asset_id: 1, date: "2026-09-30", amount_minor: 0, currency: "CHF" },
    ]);
    const { result } = await executeTool("get_asset_details", { asset_id: 1 }, ctx);
    expect((result as { change_90d_pct: number }).change_90d_pct).toBe(-100);
  });

  it("returns no change when the window starts at zero rather than dividing by it", async () => {
    // first snapshot 0: the ratio is undefined, so the change is null.
    repo.listAllSnapshotPoints.mockResolvedValue([
      { asset_id: 1, date: "2026-09-01", amount_minor: 0, currency: "CHF" },
      { asset_id: 1, date: "2026-09-30", amount_minor: 50000, currency: "CHF" },
    ]);
    const { result } = await executeTool("get_asset_details", { asset_id: 1 }, ctx);
    expect((result as { change_90d_pct: number | null }).change_90d_pct).toBeNull();
  });

  it("details measure the change from the first snapshot in the window", async () => {
    repo.listAllSnapshotPoints.mockResolvedValue([
      { asset_id: 1, date: "2026-09-01", amount_minor: 80000, currency: "CHF" },
      { asset_id: 1, date: "2026-09-30", amount_minor: 100000, currency: "CHF" },
    ]);
    const { result } = await executeTool("get_asset_details", { asset_id: 1 }, ctx);
    // The 90-day window starts on 2026-08-02, so the change runs from 2026-09-01.
    expect((result as { change_90d_pct: number }).change_90d_pct).toBe(25);
  });

  it("history returns chronological points and the change", async () => {
    const { result } = await executeTool("get_asset_history", { asset_id: 1, days: 400 }, ctx);
    expect(result).toMatchObject({
      asset_id: 1,
      data: [{ date: "2026-01-31", amount: 800 }, { date: "2026-09-30", amount: 1000 }],
      change_abs: 200,
      change_pct: 25,
    });
  });

  it("allocation buckets sum to the total", async () => {
    const { result } = await executeTool("get_allocation", { dimension: "institution" }, ctx);
    const buckets = (result as { buckets: Array<{ label: string; value_base: number; pct: number }> }).buckets;
    expect(buckets.map((b) => b.label).sort()).toEqual(["Boursorama", "UBS"]);
    expect(buckets.reduce((sum, b) => sum + b.value_base, 0)).toBe(1475);
  });

  it("reports an unknown asset instead of throwing", async () => {
    const { result } = await executeTool("get_asset_details", { asset_id: 99 }, ctx);
    expect(result).toEqual({ error: "Asset 99 not found or not yours." });
  });

  it("unknown tools return an error object", async () => {
    const { result } = await executeTool("rm_rf", {}, ctx);
    expect(result).toEqual({ error: "Unknown tool: rm_rf" });
  });
});

describe("write tools only stage a confirmation", () => {
  const ctx = { conversationId: 7, today: "2026-10-31" };

  it("propose_snapshot creates a pending action and writes no snapshot", async () => {
    const { result } = await executeTool("propose_snapshot", { asset_id: 1, amount: 1234.56 }, ctx);
    expect(repo.createPendingAction).toHaveBeenCalledWith({
      conversationId: 7,
      actionType: "create_snapshot",
      payload: { asset_id: 1, amount_minor: 123456, amount: 1234.56, date: "2026-10-31" },
    });
    expect(result).toMatchObject({ pending_action_id: 11, asset_name: "UBS - P1 (Cash)", currency: "CHF", date: "2026-10-31" });
    expect(repo.createSnapshot).not.toHaveBeenCalled();
    expect(repo.updateSnapshot).not.toHaveBeenCalled();
  });

  it("refuses a non-positive amount, a future date and a bad date", async () => {
    expect(await executeTool("propose_snapshot", { asset_id: 1, amount: 0 }, ctx)).toMatchObject({
      result: { error: "Amount must be positive." },
    });
    expect(await executeTool("propose_snapshot", { asset_id: 1, amount: 5, date: "2027-01-01" }, ctx)).toMatchObject({
      result: { error: "Date cannot be in the future." },
    });
    expect(await executeTool("propose_snapshot", { asset_id: 1, amount: 5, date: "31/10/2026" }, ctx)).toMatchObject({
      result: { error: "Invalid date format '31/10/2026'. Use YYYY-MM-DD." },
    });
    expect(repo.createPendingAction).not.toHaveBeenCalled();
  });

  it("warns with the value on that date, not the asset's latest", async () => {
    repo.getSnapshotOn.mockResolvedValue({ id: 3, asset_id: 1, date: "2026-10-31", amount_minor: 50000 });
    const { result } = await executeTool("propose_snapshot", { asset_id: 1, amount: 900 }, ctx);
    const warning = (result as { existing_snapshot_warning: string }).existing_snapshot_warning;
    expect(warning).toContain("already exists");
    expect(warning).toContain("500");
    expect(repo.getSnapshotOn).toHaveBeenCalledWith(1, "2026-10-31");
  });

  it("refuses a date that looks like ISO but does not exist", async () => {
    const bad = await executeTool("propose_snapshot", { asset_id: 1, amount: 5, date: "2026-02-31" }, ctx);
    expect((bad.result as { error: string }).error).toMatch(/Invalid date/);
    expect(repo.createPendingAction).not.toHaveBeenCalled();
  });

  it("remember_fact validates category and importance before staging", async () => {
    await executeTool("remember_fact", { category: "nonsense", key: "k", content: "c", importance: 3 }, ctx);
    await executeTool("remember_fact", { category: "goal", key: "k", content: "c", importance: 9 }, ctx);
    expect(repo.createPendingAction).not.toHaveBeenCalled();

    const { result } = await executeTool(
      "remember_fact",
      { category: "goal", key: "house", content: "User is saving for a house", importance: 5 },
      ctx,
    );
    expect(repo.createPendingAction).toHaveBeenCalledWith({
      conversationId: 7,
      actionType: "create_memory",
      payload: { category: "goal", key: "house", content: "User is saving for a house", importance: 5 },
    });
    expect(result).toMatchObject({ pending_action_id: 11, action_type: "create_memory" });
    expect(repo.createMemory).not.toHaveBeenCalled();
  });

  describe("remember_fact length limits (FIN-48)", () => {
    const base = { category: "goal", key: "house", content: "User is saving for a house", importance: 3 };

    it("refuses a key over 200 characters, with no pending action", async () => {
      const { result } = await executeTool("remember_fact", { ...base, key: "k".repeat(201) }, ctx);
      expect((result as { error: string }).error).toMatch(/limit is 200/);
      expect(repo.createPendingAction).not.toHaveBeenCalled();
    });

    it("accepts a key of exactly 200 characters", async () => {
      const { result } = await executeTool("remember_fact", { ...base, key: "k".repeat(200) }, ctx);
      expect(result).toMatchObject({ pending_action_id: 11 });
    });

    it("refuses content over 500 characters, with no pending action", async () => {
      const { result } = await executeTool("remember_fact", { ...base, content: "c".repeat(501) }, ctx);
      expect((result as { error: string }).error).toMatch(/limit is 500/);
      expect(repo.createPendingAction).not.toHaveBeenCalled();
    });

    it("counts characters, not UTF-16 units", async () => {
      // 250 emoji: 500 code points but 1000 UTF-16 units. Still within the limit.
      const emoji = "\u{1F4B0}".repeat(250);
      const { result } = await executeTool("remember_fact", { ...base, content: emoji }, ctx);
      expect(result).toMatchObject({ pending_action_id: 11 });
    });

    it("refuses a key or content that is empty after trimming", async () => {
      const blankKey = await executeTool("remember_fact", { ...base, key: "   " }, ctx);
      const blankContent = await executeTool("remember_fact", { ...base, content: "\n\t " }, ctx);
      expect((blankKey.result as { error: string }).error).toMatch(/key must not be empty/);
      expect((blankContent.result as { error: string }).error).toMatch(/content must not be empty/);
      expect(repo.createPendingAction).not.toHaveBeenCalled();
    });

    it("stores the trimmed key and content", async () => {
      await executeTool("remember_fact", { ...base, key: "  house  ", content: " User saves. " }, ctx);
      expect(repo.createPendingAction).toHaveBeenCalledWith({
        conversationId: 7,
        actionType: "create_memory",
        payload: { category: "goal", key: "house", content: "User saves.", importance: 3 },
      });
    });
  });
});
