/**
 * TikTok's seller product ID is an API identity, not a complete public URL.
 * The public Shop web page needs the seller region and locale context.
 */
function tiktokShopRegion() {
  const configuredRegion = process.env.TIKTOK_SHOP_REGION?.trim().toUpperCase();
  return configuredRegion === "UK" ? "GB" : configuredRegion || "GB";
}

function tiktokShopLocale(region: string) {
  const locales: Record<string, string> = {
    GB: "en-GB",
    US: "en-US",
    SG: "en-SG",
    MY: "en-MY",
    PH: "en-PH",
    ID: "id-ID",
    TH: "th-TH",
    VN: "vi-VN",
  };
  return locales[region] ?? `en-${region}`;
}

export function tiktokShopProductUrl(productId: string) {
  const normalizedProductId = productId.trim();
  if (!normalizedProductId) return null;

  const region = tiktokShopRegion();
  const url = new URL(`https://www.tiktok.com/view/product/${encodeURIComponent(normalizedProductId)}`);
  url.searchParams.set("region", region);
  url.searchParams.set("locale", tiktokShopLocale(region));
  url.searchParams.set("source", "seller_center");
  return url.toString();
}

function isSellerCenterUrl(url: URL) {
  return /^seller-[^.]+\.tiktok\.com$/i.test(url.hostname);
}

export function safeTikTokProductUrl(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const candidate = String(value).trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !isSellerCenterUrl(parsed)
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

/** Accept the URL field names used by TikTok's product/card payloads. */
export function extractTikTokProductUrl(product: Record<string, unknown>) {
  return safeTikTokProductUrl(
    product.product_link
      ?? product.product_url
      ?? product.product_detail_url
      ?? product.preview_url,
  );
}
