/**
 * Holdings: composition, not valuation.
 *
 * One row per ISIN. Writes happen inside `createAsset` / `updateAsset`, in the
 * same transaction as the asset, so an asset and its holdings land together.
 */

import { getDb } from "../client";

export interface HoldingRow {
  id: number;
  asset_id: number;
  isin: string;
  /** Optional instrument name, e.g. "iShares MSCI World". */
  label: string | null;
  quantity: string;
  /** Last known price per unit, in the asset's currency. */
  price: string | null;
}

export async function listHoldingsForAsset(assetId: number): Promise<HoldingRow[]> {
  const db = await getDb();
  return db.select<HoldingRow[]>(
    `SELECT id, asset_id, isin, label, quantity, price FROM asset_holdings WHERE asset_id = ? ORDER BY isin`,
    [assetId],
  );
}

/** Every holding, grouped by asset — for the export and the assistant. */
export async function listAllHoldings(): Promise<HoldingRow[]> {
  const db = await getDb();
  return db.select<HoldingRow[]>(
    `SELECT id, asset_id, isin, label, quantity, price FROM asset_holdings ORDER BY asset_id, isin`,
  );
}
