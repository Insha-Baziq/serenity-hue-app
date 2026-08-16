type ShopifyTokenResponse = { access_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown };

type ShopifyGraphqlResponse<TData> = {
  data?: TData;
  errors?: Array<{ message?: unknown }>;
};

const API_VERSION = "2026-07";

export function hasShopifyCredentials() {
  return Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
}

function requiredEnvironment(name: "SHOPIFY_STORE_DOMAIN" | "SHOPIFY_CLIENT_ID" | "SHOPIFY_CLIENT_SECRET") {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}

export async function getShopifyAccessToken() {
  const storeDomain = requiredEnvironment("SHOPIFY_STORE_DOMAIN");
  const response = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: requiredEnvironment("SHOPIFY_CLIENT_ID"),
      client_secret: requiredEnvironment("SHOPIFY_CLIENT_SECRET"),
    }),
    cache: "no-store",
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json() as ShopifyTokenResponse
    : undefined;
  if (!response.ok) {
    const reason = payload && [payload.error, payload.error_description].find((value): value is string => typeof value === "string" && value.length > 0);
    throw new Error(`Shopify token request failed (HTTP ${response.status})${reason ? `: ${reason}` : ""}`);
  }
  if (!payload) throw new Error("Shopify token request returned an unexpected response");
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Shopify token request returned no access token");
  }
  return payload.access_token;
}

export async function shopifyGraphql<TData>(query: string, variables: Record<string, unknown>) {
  const storeDomain = requiredEnvironment("SHOPIFY_STORE_DOMAIN");
  const accessToken = await getShopifyAccessToken();
  const response = await fetch(`https://${storeDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Shopify Admin API request failed (HTTP ${response.status})`);
  const payload = await response.json() as ShopifyGraphqlResponse<TData>;
  if (payload.errors?.length) {
    const messages = payload.errors.map((error) => typeof error.message === "string" ? error.message : "Unknown GraphQL error");
    throw new Error(`Shopify Admin API error: ${messages.join("; ")}`);
  }
  if (!payload.data) throw new Error("Shopify Admin API returned no data");
  return payload.data;
}
