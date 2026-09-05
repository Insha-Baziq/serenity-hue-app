export type TikTokAffiliateOrder = {
  id: string;
  connectionId: string;
  shopId: string;
  sourceOrderId: string;
  sourceLineItemId: string;
  sourceProductId?: string;
  sourceSkuId?: string;
  productTitle?: string;
  creatorOpenId?: string;
  creatorUsername?: string;
  quantity: number;
  grossAmountMinor: number;
  estimatedCommissionMinor: number;
  currency: string;
  status?: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
};

type UnknownRecord = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function amountMinor(value: unknown) {
  return Math.round(number(value) * 100);
}

function timestamp(value: unknown) {
  const numeric = number(value);
  if (numeric > 0) return new Date((numeric > 1_000_000_000_000 ? numeric : numeric * 1000)).toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return undefined;
}

/** Maps only TikTok's seller-affiliate record into the stored affiliate contract. */
export function normalizeTikTokAffiliateOrder(value: UnknownRecord, context: { connectionId: string; shopId: string }): TikTokAffiliateOrder | undefined {
  const sourceOrderId = text(value.order_id ?? value.id);
  const sourceLineItemId = text(value.order_line_id ?? value.order_item_id ?? value.line_item_id ?? value.sku_id ?? value.product_id);
  if (!sourceOrderId || !sourceLineItemId) return undefined;
  const quantity = Math.max(0, Math.round(number(value.quantity ?? value.sku_quantity ?? value.item_quantity)));
  const unitAmount = amountMinor(value.sale_price ?? value.price ?? value.order_amount ?? value.gmv);
  const product = value.product && typeof value.product === "object" ? value.product as UnknownRecord : undefined;
  const creator = value.creator && typeof value.creator === "object" ? value.creator as UnknownRecord : undefined;
  return {
    id: `tiktok-affiliate:${context.shopId}:${sourceOrderId}:${sourceLineItemId}`,
    connectionId: context.connectionId,
    shopId: context.shopId,
    sourceOrderId,
    sourceLineItemId,
    sourceProductId: text(value.product_id ?? product?.id) || undefined,
    sourceSkuId: text(value.sku_id ?? (value.sku && typeof value.sku === "object" ? (value.sku as UnknownRecord).id : undefined)) || undefined,
    productTitle: text(value.product_name ?? value.product_title ?? product?.name) || undefined,
    creatorOpenId: text(value.creator_open_id ?? value.affiliate_open_id ?? creator?.open_id) || undefined,
    creatorUsername: text(value.creator_username ?? value.affiliate_username ?? creator?.username) || undefined,
    quantity,
    grossAmountMinor: Math.max(0, unitAmount * quantity),
    estimatedCommissionMinor: Math.max(0, amountMinor(value.estimated_commission ?? value.commission ?? value.estimated_commission_amount)),
    currency: text(value.currency ?? value.currency_code).toUpperCase() || "GBP",
    status: text(value.order_status ?? value.status) || undefined,
    sourceCreatedAt: timestamp(value.create_time ?? value.created_at),
    sourceUpdatedAt: timestamp(value.update_time ?? value.updated_at),
  };
}
