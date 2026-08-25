import { requireApiSession } from "@/lib/auth-guard";
import { fetchTikTokInventory } from "@/lib/tiktok-inventory";
import { TikTokNotConnectedError } from "@/lib/tiktok-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Read-only diagnostic. Confirms the seller's re-authorized token can read
 * live TikTok Shop product inventory (the `Product basic` scope) and summarizes
 * what comes back. Returns no customer/PII data — only product/SKU IDs and quantities.
 */
export async function GET(request: Request) {
  if (!(await requireApiSession(request))) {
    return Response.json({ ok: false, message: "Authentication required" }, { status: 401 });
  }

  try {
    const { grantedScopes, shops, skus } = await fetchTikTokInventory();
    const withWarehouse = skus.filter((sku) => sku.warehouses.length > 0).length;
    return Response.json({
      ok: true,
      grantedScopes,
      canReadProducts: true,
      shops,
      productCount: new Set(skus.map((sku) => sku.productId).filter(Boolean)).size,
      skuCount: skus.length,
      skusWithWarehouseInventory: withWarehouse,
      totalUnitsOnTikTok: skus.reduce((sum, sku) => sum + sku.totalQuantity, 0),
      sample: skus.slice(0, 5).map((sku) => ({
        productTitle: sku.productTitle,
        skuId: sku.skuId,
        sellerSku: sku.sellerSku,
        variantTitle: sku.variantTitle,
        warehouses: sku.warehouses,
        totalQuantity: sku.totalQuantity,
      })),
    });
  } catch (error) {
    if (error instanceof TikTokNotConnectedError) {
      return Response.json({ ok: false, message: "TikTok Shop is not connected on this deployment" }, { status: 409 });
    }
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : "TikTok inventory read failed" },
      { status: 502 },
    );
  }
}
