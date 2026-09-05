import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTikTokAffiliateOrder } from "../lib/tiktok-affiliate.ts";

test("normalizes an affiliate order without turning estimated commission into business revenue", () => {
  const result = normalizeTikTokAffiliateOrder({
    order_id: "affiliate-order-42",
    order_line_id: "line-7",
    product_id: "product-9",
    sku_id: "sku-3",
    product_name: "Rose Candle",
    creator_open_id: "creator-1",
    creator_username: "rose_reviews",
    quantity: 2,
    sale_price: "19.95",
    estimated_commission: "2.50",
    currency: "GBP",
    order_status: "COMPLETED",
    create_time: 1_788_307_200,
    update_time: 1_788_393_600,
  }, { connectionId: "connection-1", shopId: "shop-1" });

  assert.deepEqual(result, {
    id: "tiktok-affiliate:shop-1:affiliate-order-42:line-7",
    connectionId: "connection-1",
    shopId: "shop-1",
    sourceOrderId: "affiliate-order-42",
    sourceLineItemId: "line-7",
    sourceProductId: "product-9",
    sourceSkuId: "sku-3",
    productTitle: "Rose Candle",
    creatorOpenId: "creator-1",
    creatorUsername: "rose_reviews",
    quantity: 2,
    grossAmountMinor: 3990,
    estimatedCommissionMinor: 250,
    currency: "GBP",
    status: "COMPLETED",
    sourceCreatedAt: "2026-09-02T00:00:00.000Z",
    sourceUpdatedAt: "2026-09-03T00:00:00.000Z",
  });
});
