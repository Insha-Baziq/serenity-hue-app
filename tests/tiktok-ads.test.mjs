import assert from "node:assert/strict";
import test from "node:test";
import { exchangeTikTokAdsAuthorizationCode, hasTikTokAdsAppCredentials, tiktokAdsAuthorizationUrl } from "../lib/tiktok-ads.ts";

const originalEnvironment = {
  appId: process.env.TIKTOK_ADS_APP_ID,
  secret: process.env.TIKTOK_ADS_APP_SECRET,
  redirectUri: process.env.TIKTOK_ADS_REDIRECT_URI,
};

test.after(() => {
  for (const [name, value] of Object.entries({
    TIKTOK_ADS_APP_ID: originalEnvironment.appId,
    TIKTOK_ADS_APP_SECRET: originalEnvironment.secret,
    TIKTOK_ADS_REDIRECT_URI: originalEnvironment.redirectUri,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("TikTok Ads authorization URL contains only the public OAuth parameters", () => {
  process.env.TIKTOK_ADS_APP_ID = "app-123";
  process.env.TIKTOK_ADS_APP_SECRET = "secret-value";
  process.env.TIKTOK_ADS_REDIRECT_URI = "https://example.com/api/tiktok-ads/callback";

  const url = new URL(tiktokAdsAuthorizationUrl("state-value"));
  assert.equal(url.origin, "https://business-api.tiktok.com");
  assert.equal(url.pathname, "/portal/auth");
  assert.equal(url.searchParams.get("app_id"), "app-123");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("redirect_uri"), "https://example.com/api/tiktok-ads/callback");
  assert.equal(url.searchParams.has("secret"), false);
});

test("TikTok Ads token exchange uses auth_code and normalizes advertiser access", async () => {
  process.env.TIKTOK_ADS_APP_ID = "app-123";
  process.env.TIKTOK_ADS_APP_SECRET = "secret-value";
  process.env.TIKTOK_ADS_REDIRECT_URI = "https://example.com/api/tiktok-ads/callback";
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 86400,
        refresh_token_expires_in: 31536000,
        advertiser_ids: ["advertiser-1", 2],
        scope: "report.advertiser.basic,advertiser.info",
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const tokens = await exchangeTikTokAdsAuthorizationCode("auth-code");
    assert.equal(new URL(request.input).pathname, "/open_api/v1.3/oauth2/access_token/");
    assert.deepEqual(JSON.parse(request.init.body), {
      app_id: "app-123",
      secret: "secret-value",
      auth_code: "auth-code",
    });
    assert.deepEqual(tokens.advertiserIds, ["advertiser-1", "2"]);
    assert.equal(tokens.accessToken, "access-token");
    assert.equal(tokens.refreshToken, "refresh-token");
    assert.deepEqual(tokens.grantedScopes, ["report.advertiser.basic", "advertiser.info"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TikTok Ads credentials require both app ID and secret", () => {
  process.env.TIKTOK_ADS_APP_ID = "app-123";
  process.env.TIKTOK_ADS_APP_SECRET = "";
  assert.equal(hasTikTokAdsAppCredentials(), false);
  process.env.TIKTOK_ADS_APP_SECRET = "secret-value";
  assert.equal(hasTikTokAdsAppCredentials(), true);
});
