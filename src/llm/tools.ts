/**
 * Tool definitions for the LLM chat loop — ported from
 * `app/services/tools.json`. Phase 0 ships `get_portfolio_summary` only; the
 * other six arrive in Phase 7.
 */

import { listAssets } from "../db/repositories/assets";
import { listAllSnapshotPoints } from "../db/repositories/snapshots";
import { formatMinorAsCurrency } from "../domain/format";
import { snapshotDateRange, summariseAssets } from "../domain/portfolio";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

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
];

export interface ToolResult {
  /** JSON-serialisable payload handed back to the model. */
  result: unknown;
  /** Short human line for the UI transcript. */
  summary: string;
}

/**
 * Execute a read-only tool against the local database.
 *
 * Write tools do not exist yet; in Phase 7 they will return a PendingAction for
 * the user to confirm rather than touching the database, per the source's
 * `chat_service.py` confirm flow.
 */
export async function executeTool(
  name: string,
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "get_portfolio_summary": {
      const assets = await listAssets();
      const summary = summariseAssets(assets);
      const points = await listAllSnapshotPoints();
      const range = snapshotDateRange(points);

      const byCurrency = summary.byCurrency.map((bucket) => ({
        currency: bucket.currency,
        total: formatMinorAsCurrency(bucket.totalMinor, bucket.currency),
        asset_count: bucket.assetCount,
      }));

      return {
        result: {
          total_assets: summary.totalAssets,
          assets_without_snapshots: summary.assetsWithoutSnapshots,
          last_update: range.end,
          by_currency: byCurrency,
          note:
            summary.byCurrency.length > 1
              ? "Totals are per currency; cross-currency conversion is not available yet."
              : undefined,
        },
        summary: byCurrency
          .map((bucket) => `${bucket.total} (${bucket.asset_count} assets)`)
          .join(", "),
      };
    }
    default:
      return {
        result: { error: `unknown tool: ${name}` },
        summary: `unknown tool: ${name}`,
      };
  }
}
