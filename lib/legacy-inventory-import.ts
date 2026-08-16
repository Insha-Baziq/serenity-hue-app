import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTursoClient } from "@/lib/turso";

type CsvRow = Record<string, string>;

function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  const [headers = [], ...values] = rows;
  return values.filter((valuesRow) => valuesRow.some(Boolean)).map((valuesRow) => Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/, "").trim(), valuesRow[index]?.trim() ?? ""])));
}

function readCsv(dataDirectory: string, filename: string) {
  const path = join(dataDirectory, filename);
  if (!existsSync(path)) throw new Error(`Legacy data file not found: ${filename}`);
  return parseCsv(readFileSync(path, "utf8"));
}

function numeric(value: string, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toId(value: string) {
  return `legacy-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function mappingStatus(confidence: string) {
  const normalized = confidence.toLowerCase();
  if (normalized.includes("confirmed")) return "confirmed";
  if (normalized.includes("best guess")) return "review";
  return "unmapped";
}

function legacyDataDirectory() {
  return process.env.LEGACY_CRM_DATA_DIR?.trim() || join(process.cwd(), "..", "CRM", "data");
}

function isInstructionalPackagingRow(title: string) {
  return title.trim().toLowerCase().startsWith("fill in current stock");
}

/**
 * Imports operational metadata only. Shopify remains the live quantity source,
 * so the historic workbook's quantity column is deliberately never copied.
 */
export async function importLegacyInventoryMetadata(dataDirectory = legacyDataDirectory()) {
  const [masterRows, mappingRows, bundleRows, packagingRows] = await Promise.all([
    Promise.resolve(readCsv(dataDirectory, "master_inventory.csv")),
    Promise.resolve(readCsv(dataDirectory, "tiktok_listing_map.csv")),
    Promise.resolve(readCsv(dataDirectory, "bundle_components.csv")),
    Promise.resolve(readCsv(dataDirectory, "packaging_materials.csv")),
  ]);
  const db = await getTursoClient();
  let variantsUpdated = 0;
  let mappingsImported = 0;
  let bundlesImported = 0;
  let packagingImported = 0;

  for (const row of masterRows) {
    const variantId = row["Shopify Variant ID"];
    if (!variantId) continue;
    const result = await db.execute({
      sql: `UPDATE variants SET packaging_type = ?, units_per_box = ?, lead_time_days = ? WHERE shopify_variant_id = ? OR shopify_variant_id LIKE ?`,
      args: [row["Packaging Type"] || null, Math.max(1, numeric(row["Units per Box"], 1)), row["Restock Lead Time (days)"] ? numeric(row["Restock Lead Time (days)"]) : null, variantId, `%/${variantId}`],
    });
    variantsUpdated += result.rowsAffected;
  }

  for (const row of packagingRows) {
    const title = row["Packaging Type"];
    if (!title || isInstructionalPackagingRow(title)) continue;
    const existing = await db.execute({ sql: "SELECT id FROM packaging_materials WHERE title = ? LIMIT 1", args: [title] });
    const quantity = Math.max(0, numeric(row["Qty on Hand (fill in)"]));
    const leadTime = row["Restock Lead Time (days)"] ? numeric(row["Restock Lead Time (days)"]) : null;
    if (existing.rows[0]) {
      await db.execute({ sql: "UPDATE packaging_materials SET quantity = ?, lead_time_days = ?, updated_at = ? WHERE id = ?", args: [quantity, leadTime, new Date().toISOString(), String(existing.rows[0].id)] });
    } else {
      await db.execute({ sql: "INSERT INTO packaging_materials (id, title, quantity, lead_time_days, updated_at) VALUES (?, ?, ?, ?, ?)", args: [toId(title), title, quantity, leadTime, new Date().toISOString()] });
    }
    packagingImported += 1;
  }

  for (const row of mappingRows) {
    const productId = row["Shopify Product ID"];
    const externalId = row["TikTok External ID"];
    if (!productId || !externalId) continue;
    const variants = await db.execute({
      sql: `SELECT v.id FROM variants v JOIN products p ON p.id = v.product_id WHERE p.shopify_product_id = ? OR p.shopify_product_id LIKE ?`,
      args: [productId, `%/${productId}`],
    });
    for (const variant of variants.rows) {
      const variantId = String(variant.id);
      const existing = await db.execute({ sql: "SELECT id FROM channel_mappings WHERE variant_id = ? AND channel = 'tiktok' AND external_product_id = ? LIMIT 1", args: [variantId, externalId] });
      const values = [mappingStatus(row.Confidence), Math.max(1, numeric(row["Qty of Shopify Unit per 1 TikTok Order"], 1)), row.Confidence || null, row.Notes || null, new Date().toISOString()];
      if (existing.rows[0]) {
        await db.execute({ sql: "UPDATE channel_mappings SET status = ?, multiplier = ?, confidence = ?, notes = ?, active = 1, last_checked_at = ? WHERE id = ?", args: [...values, String(existing.rows[0].id)] });
      } else {
        await db.execute({ sql: "INSERT INTO channel_mappings (id, variant_id, channel, external_product_id, status, multiplier, confidence, notes, active, last_checked_at) VALUES (?, ?, 'tiktok', ?, ?, ?, ?, ?, 1, ?)", args: [crypto.randomUUID(), variantId, externalId, ...values] });
      }
      mappingsImported += 1;
    }
  }

  await db.execute("DELETE FROM bundle_components");
  for (const row of bundleRows) {
    const componentProduct = row["Component Product"];
    const bundleName = row["Bundle Product"];
    if (!componentProduct || !bundleName) continue;
    const [bundleProduct, component] = await Promise.all([
      db.execute({ sql: "SELECT id FROM products WHERE title = ? LIMIT 1", args: [bundleName] }),
      db.execute({ sql: "SELECT id FROM products WHERE title = ? LIMIT 1", args: [componentProduct] }),
    ]);
    const componentProductId = component.rows[0] ? String(component.rows[0].id) : null;
    let componentVariantId: string | null = null;
    if (componentProductId) {
      const variants = await db.execute({ sql: "SELECT id FROM variants WHERE product_id = ? ORDER BY title LIMIT 2", args: [componentProductId] });
      if (variants.rows.length === 1) componentVariantId = String(variants.rows[0].id);
    }
    const type = row["Bundle Type"].toLowerCase().includes("tiktok") ? "tiktok_virtual" : "shopify";
    await db.execute({
      sql: `INSERT INTO bundle_components (id, bundle_name, bundle_type, bundle_product_id, tiktok_external_id, component_product_id, component_variant_id, quantity_per_sale, packaging_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [crypto.randomUUID(), bundleName, type, bundleProduct.rows[0] ? String(bundleProduct.rows[0].id) : null, row["TikTok External ID (virtual only)"] || null, componentProductId, componentVariantId, Math.max(1, numeric(row["Qty of Component per 1 Sold"], 1)), row["Packaging Type"] || null],
    });
    bundlesImported += 1;
  }

  await db.execute({
    sql: `INSERT INTO inventory_settings (key, value, updated_at) VALUES ('legacy-metadata-imported-at', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [new Date().toISOString(), new Date().toISOString()],
  });

  return { variantsUpdated, mappingsImported, bundlesImported, packagingImported };
}
