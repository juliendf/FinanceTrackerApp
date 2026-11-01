/** Assets: typed SQL only. Multi-statement writes go through `run_transaction`. */

import { getDb } from "../client";
import { runTransaction, runTransactionReturningId, justInserted, nextId } from "../transaction";
import { todayIso } from "../../domain/dates";
import { sqlInt, sqlText, decimalText, amountMinor } from "../literals";
import type { AssetRow } from "../../domain/assets";

export type { AssetRow };

/** Row shape of the plain asset table. */
export interface AssetRecord {
  id: number;
  institution_id: number;
  category_id: number;
  currency: string;
  product_name: string;
  name: string | null;
  description: string | null;
  notes: string | null;
  code_nin: string | null;
  cost_charges: string | null;
  interest_rate: string | null;
  created_at: string;
  updated_at: string;
}

type AssetRowWithoutTags = Omit<AssetRow, "tags">;

const LIST_SQL = `
  SELECT a.id, a.institution_id, a.category_id, a.currency, a.product_name,
         a.name, a.description, a.notes, a.code_nin, a.cost_charges,
         a.interest_rate, a.created_at, a.updated_at,
         i.name AS institution_name,
         c.name AS category_name,
         c.color AS category_color,
         s.amount_minor AS latest_amount_minor,
         s.date AS latest_date
    FROM assets a
    JOIN institutions i ON i.id = a.institution_id
    JOIN categories  c ON c.id = a.category_id
    LEFT JOIN snapshots s
      ON s.asset_id = a.id
     AND s.date = (SELECT MAX(date) FROM snapshots WHERE asset_id = a.id)
`;

async function tagsByAsset(): Promise<Map<number, AssetRow["tags"]>> {
  const db = await getDb();
  const rows = await db.select<
    Array<{ asset_id: number; id: number; name: string; color: string | null }>
  >(
    `SELECT at.asset_id, t.id, t.name, t.color
       FROM asset_tags at
       JOIN tags t ON t.id = at.tag_id
      ORDER BY t.name COLLATE NOCASE ASC`,
  );
  const map = new Map<number, AssetRow["tags"]>();
  for (const row of rows) {
    const list = map.get(row.asset_id) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    map.set(row.asset_id, list);
  }
  return map;
}

/** Every asset with its labels, latest value and tags. */
export async function listAssets(): Promise<AssetRow[]> {
  const db = await getDb();
  const [rows, tags] = await Promise.all([
    db.select<AssetRowWithoutTags[]>(LIST_SQL),
    tagsByAsset(),
  ]);
  return rows.map((row) => ({ ...row, tags: tags.get(row.id) ?? [] }));
}

export async function getAssetRow(id: number): Promise<AssetRow | null> {
  const db = await getDb();
  const [rows, tags] = await Promise.all([
    db.select<AssetRowWithoutTags[]>(`${LIST_SQL} WHERE a.id = ?`, [id]),
    tagsByAsset(),
  ]);
  const row = rows[0];
  return row ? { ...row, tags: tags.get(row.id) ?? [] } : null;
}

export async function getAsset(id: number): Promise<AssetRecord | null> {
  const db = await getDb();
  const rows = await db.select<AssetRecord[]>(`SELECT * FROM assets WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

export interface AssetWriteInput {
  institution_id: number;
  category_id: number;
  currency: string;
  product_name: string;
  name: string | null;
  description: string | null;
  notes: string | null;
  code_nin: string | null;
  /** Decimal strings, e.g. "0.25". */
  cost_charges: string | null;
  interest_rate: string | null;
  tag_ids: number[];
}

export interface CreateAssetInput extends AssetWriteInput {
  /** Major units. Omitted or empty means no first snapshot. */
  initial_amount?: string | null;
  initial_date?: string | null;
}

function assetColumns(input: AssetWriteInput): string[] {
  return [
    sqlInt(input.institution_id),
    sqlInt(input.category_id),
    sqlText(input.currency),
    sqlText(input.product_name.trim()),
    sqlText(input.name?.trim() || null),
    sqlText(input.description?.trim() || null),
    sqlText(input.notes?.trim() || null),
    sqlText(input.code_nin?.trim() || null),
    decimalText(input.cost_charges),
    decimalText(input.interest_rate),
  ];
}

/**
 * Create an asset, its tags and (optionally) its first snapshot — atomically.
 *
 * Replaces the Phase 0 compensating-delete: the asset id is allocated inside the
 * transaction (`nextId`) and referenced afterwards (`justInserted`), so a failed
 * snapshot insert rolls the whole thing back instead of leaving an asset behind.
 */
export async function createAsset(input: CreateAssetInput): Promise<number> {
  const statements: string[] = [
    `INSERT INTO assets
       (id, institution_id, category_id, currency, product_name, name,
        description, notes, code_nin, cost_charges, interest_rate)
     VALUES (${nextId("assets")}, ${assetColumns(input).join(", ")})`,
  ];

  for (const tagId of new Set(input.tag_ids)) {
    statements.push(
      `INSERT INTO asset_tags (asset_id, tag_id) VALUES (${justInserted("assets")}, ${sqlInt(tagId)})`,
    );
  }

  if (input.initial_amount && input.initial_amount.trim() !== "") {
    // Local calendar date: `toISOString` is UTC, which dated an asset created
    // between midnight and 02:00 in Zurich to the previous day.
    const date = input.initial_date || todayIso();
    statements.push(
      `INSERT INTO snapshots (asset_id, date, amount_minor)
       VALUES (${justInserted("assets")}, ${sqlText(date)}, ${amountMinor(input.initial_amount)})`,
    );
  }

  // The id is read inside the same transaction: a pooled `SELECT seq` afterwards
  // could see another asset's row.
  return runTransactionReturningId(statements, "assets");
}

/** Update an asset and replace its tags in one transaction. */
export async function updateAsset(id: number, input: AssetWriteInput): Promise<void> {
  const [institution, category, currency, product, name, description, notes, code, cost, interest] =
    assetColumns(input);

  const statements = [
    `UPDATE assets
        SET institution_id = ${institution}, category_id = ${category},
            currency = ${currency}, product_name = ${product}, name = ${name},
            description = ${description}, notes = ${notes}, code_nin = ${code},
            cost_charges = ${cost}, interest_rate = ${interest},
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ${sqlInt(id)}`,
    `DELETE FROM asset_tags WHERE asset_id = ${sqlInt(id)}`,
    ...[...new Set(input.tag_ids)].map(
      (tagId) =>
        `INSERT INTO asset_tags (asset_id, tag_id) VALUES (${sqlInt(id)}, ${sqlInt(tagId)})`,
    ),
  ];
  await runTransaction(statements);
}

/**
 * Delete an asset with its snapshots and tag links.
 *
 * Explicit deletes in one transaction rather than relying on `ON DELETE CASCADE`:
 * the plugin's pooled connections do not all have `foreign_keys` switched on.
 */
export async function deleteAsset(id: number): Promise<void> {
  await runTransaction([
    `DELETE FROM asset_tags WHERE asset_id = ${sqlInt(id)}`,
    `DELETE FROM snapshots WHERE asset_id = ${sqlInt(id)}`,
    `DELETE FROM assets WHERE id = ${sqlInt(id)}`,
  ]);
}

export async function countAssets(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM assets`);
  return rows[0]?.n ?? 0;
}
