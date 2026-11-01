/**
 * Tool definitions and executors — port of `app/services/tools.json` and
 * `services/chat_tools.py`.
 *
 * Write tools never write. `propose_snapshot` and `remember_fact` create a
 * `pending_actions` row and return its id; the UI's confirm card is the only
 * path to the database, which is what makes "no write without confirmation"
 * true by construction rather than by prompt discipline.
 */

import Decimal from "decimal.js";
import { listAssets } from "../db/repositories/assets";
import {
  createPendingAction,
  listPendingActions,
  listRecentMessages,
} from "../db/repositories/chat";
import { listTopMemories } from "../db/repositories/profile";
import { getSnapshotOn, listAllSnapshotPoints } from "../db/repositories/snapshots";
import { getAllSettings } from "../db/repositories/settings";
import { displayName } from "../domain/assets";
import { CurrencyConverter, RateTable } from "../domain/currency";
import { latestPerAsset, summarise, type Fact } from "../domain/dashboard";
import { addDays, isValidIsoDate, todayIso } from "../domain/dates";
import { formatCurrency } from "../domain/format";
import { listExchangeRates } from "../db/repositories/exchangeRates";
import { listFacts, listAssetCurrencies } from "../db/repositories/dashboard";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Verbatim from `tools.json`. */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_portfolio_summary",
      description:
        "Get the user's portfolio summary: total value in base currency, asset count, last update date.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_assets",
      description:
        "List the user's assets with optional filtering by institution, category, or tag. Returns id, name, institution, currency, and latest value. Use this to resolve a spoken asset name to an asset_id.",
      parameters: {
        type: "object",
        properties: {
          institution_name: {
            type: "string",
            description: "Filter by institution name (case-insensitive partial match)",
          },
          category_name: {
            type: "string",
            description: "Filter by category name (case-insensitive partial match)",
          },
          tag_name: {
            type: "string",
            description: "Filter by tag name (case-insensitive partial match)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_asset_details",
      description:
        "Get detailed metadata for a specific asset by ID, including its description and free-form notes, product name, cost charges, interest rate, latest snapshot and 30/90-day change.",
      parameters: {
        type: "object",
        properties: {
          asset_id: { type: "integer", description: "The asset ID (use list_assets first to find it)" },
        },
        required: ["asset_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_asset_history",
      description:
        "Get historical snapshot values for an asset. Returns chronological data and change summary.",
      parameters: {
        type: "object",
        properties: {
          asset_id: { type: "integer", description: "The asset ID" },
          days: { type: "integer", description: "Number of days of history (default 90)" },
        },
        required: ["asset_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_allocation",
      description:
        "Get portfolio allocation broken down by category, institution, or currency. Percentages sum to ~100%.",
      parameters: {
        type: "object",
        properties: {
          dimension: {
            type: "string",
            enum: ["category", "institution", "currency"],
            description: "How to break down the allocation",
          },
        },
        required: ["dimension"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_snapshot",
      description:
        "Propose recording a new asset value. This creates a confirmation request — it does NOT save data. The user must confirm via the UI card. Use this instead of directly creating snapshots.",
      parameters: {
        type: "object",
        properties: {
          asset_id: { type: "integer", description: "The asset ID to record a value for" },
          amount: { type: "number", description: "The value amount (must be positive)" },
          date: { type: "string", description: "Date in YYYY-MM-DD format (defaults to today)" },
        },
        required: ["asset_id", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description:
        "Remember an important fact about the user for future conversations. Use this when the user shares something significant about themselves (life event, financial goal, preference, personal situation). The fact will be stored with a confirmation request.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["personal", "financial", "goal", "preference", "life_event"],
            description: "Category of the memory",
          },
          key: { type: "string", description: "Short label (max 200 chars), e.g. 'house_downpayment', 'kids_ages'" },
          content: {
            type: "string",
            description:
              "The fact to remember, written in third person, e.g. 'User is saving for a house downpayment of CHF 100k in the next 3 years'",
          },
          importance: {
            type: "integer",
            description: "How important is this fact? 1=trivial, 3=useful, 5=critical for financial advice",
          },
        },
        required: ["category", "key", "content", "importance"],
      },
    },
  },
];

/**
 * What to say while a tool runs. The transcript stays quiet, so this is the only
 * place the user learns what the pause is for.
 */
const TOOL_STATUS: Record<string, string> = {
  get_portfolio_summary: "Looking up your portfolio…",
  list_assets: "Listing your assets…",
  get_asset_details: "Reading that asset's details…",
  get_asset_history: "Reading the value history…",
  get_allocation: "Breaking down your allocation…",
  propose_snapshot: "Preparing a snapshot for you to confirm…",
  remember_fact: "Preparing a note to remember…",
};

export function toolStatusLabel(name: string): string {
  return TOOL_STATUS[name] ?? "Working…";
}

export interface ToolResult {
  /** JSON-serialisable payload handed back to the model. */
  result: unknown;
  /** Short human line for the UI transcript. */
  summary: string;
}

export interface ToolContext {
  conversationId: number;
  /** Frozen for tests; defaults to the local date. */
  today?: string;
}

const round2 = (value: Decimal): number => value.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber();
const major = (minor: number): Decimal => new Decimal(minor).dividedBy(100);

/**
 * A money value as the app would display it, for the model to copy.
 *
 * Without this the model is handed a bare number and a currency code, and small
 * models fill the gap themselves — one answer came back as `₫ 578’865` for a
 * portfolio in CHF, with home-made digit grouping. The `_display` fields exist so
 * there is nothing to invent: the prompt tells the model to copy them verbatim.
 */
function displayMoney(amountMinor: number | null, currency: string): string | null {
  if (amountMinor === null) return null;
  // `formatCurrency` is a port of the source's filter, whose CHF symbol carries a
  // trailing space; trim it, since this string goes into prose.
  return formatCurrency(major(amountMinor), currency).trim();
}

/**
 * The start of a look-back window.
 *
 * The source computes `today.replace(day=max(1, today.day - days))`, which only
 * ever shifts the day *within the same month*: on the 31st, "90 days" becomes
 * the 1st of that month and history is nearly empty. That is a bug, not a
 * behaviour worth keeping, so this subtracts real days (docs/DEVIATIONS.md).
 */
function lookBack(today: string, days: number): string {
  return addDays(today, -Math.max(0, days));
}

async function converterFor(): Promise<{ converter: CurrencyConverter; baseCurrency: string }> {
  const [settings, rates] = await Promise.all([getAllSettings(), listExchangeRates()]);
  const baseCurrency = String(settings.base_currency ?? "EUR");
  return { converter: new CurrencyConverter(new RateTable(rates), baseCurrency), baseCurrency };
}

async function portfolioFacts(): Promise<{ facts: Fact[]; currencies: string[] }> {
  const [facts, currencies] = await Promise.all([listFacts(), listAssetCurrencies()]);
  return { facts, currencies };
}

// --- read tools -----------------------------------------------------------------

async function portfolioSummary(): Promise<unknown> {
  const [{ converter, baseCurrency }, { facts, currencies }] = await Promise.all([converterFor(), portfolioFacts()]);
  const summary = summarise(facts, currencies, converter, todayIso());
  const latest = latestPerAsset(facts).reduce<string | null>(
    (max, fact) => (max === null || fact.date > max ? fact.date : max),
    null,
  );
  return {
    total_value_base: round2(summary.portfolioValue),
    total_value_display: formatCurrency(summary.portfolioValue, baseCurrency).trim(),
    base_currency: baseCurrency,
    asset_count: summary.totalAssets,
    last_update_date: latest ?? "N/A",
    days_since_update: summary.daysSinceUpdate,
  };
}

async function listAssetsTool(args: Record<string, unknown>): Promise<unknown> {
  const needle = (value: unknown) => (typeof value === "string" && value.trim() ? value.toLowerCase() : null);
  const institution = needle(args.institution_name);
  const category = needle(args.category_name);
  const tag = needle(args.tag_name);

  let rows = await listAssets();
  if (institution) rows = rows.filter((row) => row.institution_name.toLowerCase().includes(institution));
  if (category) rows = rows.filter((row) => row.category_name.toLowerCase().includes(category));
  if (tag) rows = rows.filter((row) => row.tags.some((t) => t.name.toLowerCase().includes(tag)));

  // Sort first, then cap: slicing first dropped arbitrary assets, so a named
  // asset could be missing from a list of more than fifty.
  return rows
    .sort(
      (a, b) =>
        a.institution_name.localeCompare(b.institution_name) || a.product_name.localeCompare(b.product_name),
    )
    .slice(0, 50)
    .map((row) => ({
      asset_id: row.id,
      name: displayName(row),
      institution: row.institution_name,
      category: row.category_name,
      currency: row.currency,
      latest_amount: row.latest_amount_minor === null ? null : round2(major(row.latest_amount_minor)),
      latest_amount_display: displayMoney(row.latest_amount_minor, row.currency),
      latest_date: row.latest_date,
    }));
}

async function assetDetails(assetId: number, today: string): Promise<unknown> {
  const rows = await listAssets();
  const asset = rows.find((row) => row.id === assetId);
  if (!asset) return { error: `Asset ${assetId} not found or not yours.` };

  const points = (await listAllSnapshotPoints())
    .filter((point) => point.asset_id === assetId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = points[points.length - 1];

  const change = (days: number): number | null => {
    const since = lookBack(today, days);
    const first = points.find((point) => point.date >= since);
    // The guard has to cover the denominator: a first snapshot of 0 makes the
    // change infinite, while a latest of 0 is a real drop to zero.
    if (!first || !latest || first.amount_minor === 0) return null;
    return round2(
      new Decimal(latest.amount_minor - first.amount_minor).dividedBy(first.amount_minor).times(100),
    );
  };

  return {
    asset_id: asset.id,
    name: displayName(asset),
    institution: asset.institution_name,
    category: asset.category_name,
    currency: asset.currency,
    product_name: asset.product_name,
    description: asset.description,
    cost_charges: asset.cost_charges,
    interest_rate: asset.interest_rate,
    notes: asset.notes,
    latest_amount: latest ? round2(major(latest.amount_minor)) : null,
    latest_amount_display: latest ? displayMoney(latest.amount_minor, asset.currency) : null,
    latest_date: latest?.date ?? null,
    change_30d_pct: change(30),
    change_90d_pct: change(90),
  };
}

async function assetHistory(assetId: number, days: number, today: string): Promise<unknown> {
  const rows = await listAssets();
  const asset = rows.find((row) => row.id === assetId);
  if (!asset) return { error: `Asset ${assetId} not found or not yours.` };

  const since = lookBack(today, days);
  const points = (await listAllSnapshotPoints())
    .filter((point) => point.asset_id === assetId && point.date >= since)
    .sort((a, b) => a.date.localeCompare(b.date));

  const data = points.map((point) => ({ date: point.date, amount: round2(major(point.amount_minor)) }));
  let changeAbs: number | null = null;
  let changePct: number | null = null;
  if (points.length >= 2) {
    const first = points[0].amount_minor;
    const last = points[points.length - 1].amount_minor;
    changeAbs = round2(major(last - first));
    if (first !== 0) changePct = round2(new Decimal(last - first).dividedBy(first).times(100));
  }

  return {
    asset_id: assetId,
    asset_name: displayName(asset),
    currency: asset.currency,
    data,
    change_abs: changeAbs,
    change_pct: changePct,
  };
}

async function allocation(dimension: string): Promise<unknown> {
  const { converter, baseCurrency } = await converterFor();
  const { facts } = await portfolioFacts();

  const buckets = new Map<string, Decimal>();
  let total = new Decimal(0);
  for (const fact of latestPerAsset(facts)) {
    const value = converter.convert(major(fact.amount_minor), fact.currency);
    const key =
      dimension === "category"
        ? fact.category_name || "Uncategorized"
        : dimension === "institution"
          ? fact.institution_name || "Unknown"
          : fact.currency;
    buckets.set(key, (buckets.get(key) ?? new Decimal(0)).plus(value));
    total = total.plus(value);
  }

  const result = [...buckets.entries()]
    .sort((a, b) => b[1].comparedTo(a[1]))
    .map(([label, value]) => ({
      label,
      value_base: round2(value),
      pct: total.isZero() ? 0 : round2(value.dividedBy(total).times(100)),
    }));

  return {
    dimension,
    base_currency: baseCurrency,
    total_base: round2(total),
    total_base_display: formatCurrency(total, baseCurrency).trim(),
    buckets: result,
  };
}

// --- write tools (confirmation only) ----------------------------------------------

async function proposeSnapshot(
  ctx: ToolContext,
  assetId: number,
  amount: number,
  date?: string,
): Promise<unknown> {
  const today = ctx.today ?? todayIso();
  if (!(amount > 0)) return { error: "Amount must be positive." };

  const rows = await listAssets();
  const asset = rows.find((row) => row.id === assetId);
  if (!asset) return { error: `Asset ${assetId} not found or not yours.` };

  const isoDate = date?.trim() || today;
  // A regex alone accepts 2026-02-31; the calendar check rejects it.
  if (!isValidIsoDate(isoDate)) {
    return { error: `Invalid date format '${date}'. Use YYYY-MM-DD.` };
  }
  if (isoDate > today) return { error: "Date cannot be in the future." };

  let warning: string | null = null;
  const existing = await getSnapshotOn(assetId, isoDate);
  if (existing) {
    // The value on *that* date is what a confirm would overwrite — not the
    // asset's latest value, which could be a different balance entirely.
    warning =
      `A snapshot for ${displayName(asset)} on ${isoDate} already exists` +
      ` with value ${round2(major(existing.amount_minor))}` +
      ". If the user confirms, it will be updated.";
  }

  const amountMinor = new Decimal(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).times(100).toNumber();
  const id = await createPendingAction({
    conversationId: ctx.conversationId,
    actionType: "create_snapshot",
    payload: { asset_id: assetId, amount_minor: amountMinor, amount, date: isoDate },
  });

  return {
    pending_action_id: id,
    asset_name: displayName(asset),
    amount,
    currency: asset.currency,
    date: isoDate,
    action_type: "create_snapshot",
    ...(warning ? { existing_snapshot_warning: warning } : {}),
  };
}

const MEMORY_CATEGORIES = ["personal", "financial", "goal", "preference", "life_event"];

async function rememberFact(
  ctx: ToolContext,
  category: string,
  key: string,
  content: string,
  importance: number,
): Promise<unknown> {
  if (!MEMORY_CATEGORIES.includes(category)) {
    return { error: `Invalid category '${category}'. Must be one of ${JSON.stringify(MEMORY_CATEGORIES)}.` };
  }
  const weight = Number(importance);
  if (!Number.isInteger(weight) || weight < 1 || weight > 5) {
    return { error: "Importance must be between 1 and 5." };
  }

  const id = await createPendingAction({
    conversationId: ctx.conversationId,
    actionType: "create_memory",
    payload: { category, key, content, importance: weight },
  });
  return { pending_action_id: id, category, key, content, importance: weight, action_type: "create_memory" };
}

/**
 * Dispatch a tool call. Never throws: a failure becomes a JSON error the model
 * can read and recover from, exactly as `execute_tool` does.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const today = ctx.today ?? todayIso();
  try {
    switch (name) {
      case "get_portfolio_summary": {
        const result = await portfolioSummary();
        return { result, summary: "portfolio summary" };
      }
      case "list_assets": {
        const result = await listAssetsTool(args);
        return { result, summary: `listed ${(result as unknown[]).length} assets` };
      }
      case "get_asset_details": {
        const result = await assetDetails(Number(args.asset_id), today);
        return { result, summary: `details for asset ${String(args.asset_id)}` };
      }
      case "get_asset_history": {
        const days = args.days === undefined ? 90 : Number(args.days);
        const result = await assetHistory(Number(args.asset_id), Number.isFinite(days) ? days : 90, today);
        return { result, summary: `history for asset ${String(args.asset_id)}` };
      }
      case "get_allocation": {
        const result = await allocation(String(args.dimension ?? "category"));
        return { result, summary: `allocation by ${String(args.dimension ?? "category")}` };
      }
      case "propose_snapshot": {
        const result = await proposeSnapshot(
          { ...ctx, today },
          Number(args.asset_id),
          Number(args.amount),
          typeof args.date === "string" ? args.date : undefined,
        );
        return { result, summary: "snapshot proposed (awaiting confirmation)" };
      }
      case "remember_fact": {
        const result = await rememberFact(
          ctx,
          String(args.category ?? ""),
          String(args.key ?? ""),
          String(args.content ?? ""),
          Number(args.importance),
        );
        return { result, summary: "memory proposed (awaiting confirmation)" };
      }
      default:
        return { result: { error: `Unknown tool: ${name}` }, summary: `unknown tool ${name}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { result: { error: `Error executing ${name}: ${message}` }, summary: `${name} failed` };
  }
}

/** Tool calls a transcript should render (used by the chat UI). */
export async function recentToolActivity(conversationId: number): Promise<number> {
  return (await listRecentMessages(conversationId, 60)).filter((row) => row.role === "tool").length;
}

/** Re-exported so the UI can show what is staged without a second import. */
export { listPendingActions, listTopMemories, addDays };
