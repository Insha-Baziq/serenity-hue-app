import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateTikTokAdsReportRows,
  fetchTikTokAdsReport,
  normalizeTikTokAdsReportRows,
  tiktokAdsReportingWindow,
} from "../lib/tiktok-ads-reporting.ts";

test("TikTok Ads reporting uses the configured history baseline and rolling seven-day London window", () => {
  const now = new Date("2026-09-10T00:30:00.000Z");
  assert.deepEqual(tiktokAdsReportingWindow(now, "baseline"), {
    kind: "baseline",
    startDate: "2026-04-01",
    endDate: "2026-09-10",
    retainedBeforeDate: "2026-04-01",
  });
  assert.deepEqual(tiktokAdsReportingWindow(now, "rolling"), {
    kind: "rolling",
    startDate: "2026-09-04",
    endDate: "2026-09-10",
    retainedBeforeDate: "2026-04-01",
  });
});

test("TikTok Ads normalization preserves provider evidence and converts money to minor units", () => {
  const result = normalizeTikTokAdsReportRows({
    advertiserId: "advertiser-1",
    fetchedAt: "2026-09-10T08:00:00.000Z",
    rows: [{
      dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-08" },
      metrics: {
        currency: "GBP",
        spend: "12.34",
        total_onsite_shopping_value: "99.95",
        shop_total_purchase_by_order_submission: "3",
        impressions: "1000",
        clicks: "25",
      },
    }],
  });

  assert.equal(result.skippedRows, 0);
  assert.deepEqual(result.records[0], {
    id: "tiktok-ads:advertiser-1:AUCTION:AUCTION_ADVERTISER:advertiser_id=advertiser-1|stat_time_day=2026-09-08",
    advertiserId: "advertiser-1",
    reportDate: "2026-09-08",
    reportType: "BASIC",
    serviceType: "AUCTION",
    dataLevel: "AUCTION_ADVERTISER",
    dimensionKey: "advertiser_id=advertiser-1|stat_time_day=2026-09-08",
    providerCurrency: "GBP",
    spendMinor: 1234,
    attributedRevenueMinor: 9995,
    attributedPurchases: 3,
    impressions: 1000,
    clicks: 25,
    sourceDimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-08" },
    sourceMetrics: {
      currency: "GBP",
      spend: "12.34",
      total_onsite_shopping_value: "99.95",
      shop_total_purchase_by_order_submission: "3",
      impressions: "1000",
      clicks: "25",
    },
    attributionWindow: null,
    fetchedAt: "2026-09-10T08:00:00.000Z",
  });
});

test("TikTok Ads normalization canonicalizes provider daily timestamps", () => {
  const result = normalizeTikTokAdsReportRows({
    advertiserId: "advertiser-1",
    fetchedAt: "2026-09-10T08:00:00.000Z",
    rows: [{
      dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-04-26 00:00:00" },
      metrics: { currency: "GBP", spend: "14.65", total_onsite_shopping_value: "93.00", shop_total_purchase_by_order_submission: "1", impressions: "504", clicks: "15" },
    }],
  });

  assert.equal(result.skippedRows, 0);
  assert.equal(result.records[0].reportDate, "2026-04-26");
  assert.equal(result.records[0].sourceDimensions.stat_time_day, "2026-04-26");
});

test("TikTok Ads normalization distinguishes absent metrics from provider zeroes", () => {
  const result = normalizeTikTokAdsReportRows({
    advertiserId: "advertiser-1",
    fetchedAt: "2026-09-10T08:00:00.000Z",
    rows: [
      {
        dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-08" },
        metrics: { currency: "GBP", spend: "0", impressions: "0" },
      },
      {
        dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-09" },
        metrics: { currency: "GBP", spend: "1.00", total_onsite_shopping_value: "0", shop_total_purchase_by_order_submission: "0" },
      },
    ],
  });

  assert.equal(result.records[0].attributedRevenueMinor, null);
  assert.equal(result.records[0].attributedPurchases, null);
  assert.equal(result.records[0].spendMinor, 0);
  assert.equal(result.records[1].attributedRevenueMinor, 0);
  assert.equal(result.records[1].attributedPurchases, 0);
});

test("TikTok Ads normalization skips rows that cannot carry trustworthy attribution evidence", () => {
  const result = normalizeTikTokAdsReportRows({
    advertiserId: "advertiser-1",
    fetchedAt: "2026-09-10T08:00:00.000Z",
    rows: [
      { dimensions: { advertiser_id: "advertiser-2", stat_time_day: "2026-09-08" }, metrics: { currency: "GBP", spend: "1" } },
      { dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-8" }, metrics: { currency: "GBP", spend: "1" } },
      { dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-09" }, metrics: { spend: "1" } },
      { dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-10" }, metrics: { currency: "GBP", spend: "not-a-number" } },
    ],
  });

  assert.equal(result.records.length, 0);
  assert.equal(result.skippedRows, 4);
});

test("TikTok Ads aggregation keeps provider attribution separate from spend and preserves unavailable totals", () => {
  const normalized = normalizeTikTokAdsReportRows({
    advertiserId: "advertiser-1",
    fetchedAt: "2026-09-10T08:00:00.000Z",
    rows: [
      {
        dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-08" },
        metrics: { currency: "GBP", spend: "10.00", total_onsite_shopping_value: "25.00", shop_total_purchase_by_order_submission: "2", impressions: "100", clicks: "5" },
      },
      {
        dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-09" },
        metrics: { currency: "GBP", spend: "5.00", impressions: "50", clicks: "2" },
      },
    ],
  });

  const report = aggregateTikTokAdsReportRows(normalized.records, { start: "2026-09-08", end: "2026-09-09" });
  assert.equal(report.currency, "GBP");
  assert.deepEqual(report.metrics, {
    spendMinor: 1500,
    attributedRevenueMinor: 2500,
    attributedPurchases: 2,
    impressions: 150,
    clicks: 7,
    roas: 2500 / 1500,
  });
  assert.equal(report.attributionEvidenceRows, 1);
  assert.deepEqual(report.trend.map(({ date, spendMinor, attributedRevenueMinor, attributedPurchases }) => ({ date, spendMinor, attributedRevenueMinor, attributedPurchases })), [
    { date: "2026-09-08", spendMinor: 1000, attributedRevenueMinor: 2500, attributedPurchases: 2 },
    { date: "2026-09-09", spendMinor: 500, attributedRevenueMinor: null, attributedPurchases: null },
  ]);
});

test("TikTok Ads aggregation returns unavailable money when provider currencies conflict", () => {
  const normalized = normalizeTikTokAdsReportRows({
    advertiserId: "advertiser-1",
    fetchedAt: "2026-09-10T08:00:00.000Z",
    rows: [
      { dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-08" }, metrics: { currency: "GBP", spend: "1.00", total_onsite_shopping_value: "2.00" } },
      { dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-09" }, metrics: { currency: "USD", spend: "1.00", total_onsite_shopping_value: "2.00" } },
    ],
  });

  const report = aggregateTikTokAdsReportRows(normalized.records, { start: "2026-09-08", end: "2026-09-09" });
  assert.equal(report.currency, null);
  assert.equal(report.metrics.spendMinor, null);
  assert.equal(report.metrics.attributedRevenueMinor, null);
});

test("TikTok Ads aggregation keeps advertiser totals separate from provider breakdowns and exposes metadata", () => {
  const advertiser = normalizeTikTokAdsReportRows({
    advertiserId: "advertiser-1",
    fetchedAt: "2026-09-10T08:00:00.000Z",
    rows: [{
      dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-08" },
      metrics: { currency: "GBP", spend: "10.00", total_onsite_shopping_value: "25.00", shop_total_purchase_by_order_submission: "2", impressions: "100", clicks: "5", advertiser_name: "Serenity Hue Ads", attribution_window: "7d click / 1d view" },
    }],
  });
  const campaign = normalizeTikTokAdsReportRows({
    advertiserId: "advertiser-1",
    fetchedAt: "2026-09-10T08:00:00.000Z",
    dataLevel: "AUCTION_CAMPAIGN",
    rows: [{
      dimensions: { campaign_id: "campaign-1", stat_time_day: "2026-09-08" },
      metrics: { currency: "GBP", spend: "10.00", total_onsite_shopping_value: "25.00", shop_total_purchase_by_order_submission: "2", impressions: "100", clicks: "5", campaign_name: "Autumn launch" },
    }],
  });
  const report = aggregateTikTokAdsReportRows([...advertiser.records, ...campaign.records], { start: "2026-09-08", end: "2026-09-08" });

  assert.equal(report.advertiserName, "Serenity Hue Ads");
  assert.equal(report.attributionWindow, "7d click / 1d view");
  assert.deepEqual(report.reportTypes, ["BASIC"]);
  assert.deepEqual(report.dataLevels, ["AUCTION_ADVERTISER", "AUCTION_CAMPAIGN"]);
  assert.equal(report.metrics.spendMinor, 1000);
  assert.equal(report.breakdowns.campaign[0].id, "campaign-1");
  assert.equal(report.breakdowns.campaign[0].name, "Autumn launch");
  assert.equal(report.breakdowns.campaign[0].roas, 2.5);
});

test("TikTok Ads product attribution is unavailable without provider product identifiers and zero spend ROAS is safe", () => {
  const normalized = normalizeTikTokAdsReportRows({
    advertiserId: "advertiser-1",
    fetchedAt: "2026-09-10T08:00:00.000Z",
    rows: [{
      dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-08" },
      metrics: { currency: "GBP", spend: "0", total_onsite_shopping_value: "0", shop_total_purchase_by_order_submission: "0", impressions: "0", clicks: "0" },
    }],
  });
  const report = aggregateTikTokAdsReportRows(normalized.records, { start: "2026-09-08", end: "2026-09-08" });
  assert.equal(report.metrics.roas, null);
  assert.equal(report.trend[0].roas, null);
  assert.equal(report.productAttribution.status, "unavailable");
  assert.match(report.productAttribution.reason, /did not supply product-level attribution/);
});

test("TikTok Ads product attribution is available only when provider rows include product identifiers", () => {
  const normalized = normalizeTikTokAdsReportRows({
    advertiserId: "advertiser-1",
    fetchedAt: "2026-09-10T08:00:00.000Z",
    rows: [{
      dimensions: { advertiser_id: "advertiser-1", stat_time_day: "2026-09-08", product_id: "product-1", product_name: "Rose candle" },
      metrics: { currency: "GBP", spend: "1.00", total_onsite_shopping_value: "3.00", shop_total_purchase_by_order_submission: "1", impressions: "10", clicks: "1" },
    }],
  });
  const report = aggregateTikTokAdsReportRows(normalized.records, { start: "2026-09-08", end: "2026-09-08" });
  assert.equal(report.productAttribution.status, "available");
  assert.deepEqual(report.productAttribution.rows[0], {
    productId: "product-1",
    productName: "Rose candle",
    currency: "GBP",
    spendMinor: 100,
    attributedRevenueMinor: 300,
    attributedPurchases: 1,
    rowCount: 1,
  });
});

test("TikTok Ads report fetch uses the official integrated report contract and paginates", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    const page = new URL(String(input)).searchParams.get("page");
    const payload = page === "1"
      ? { code: 0, message: "OK", data: { page_info: { page: 1, total_page: 2 }, list: [{ dimensions: { stat_time_day: "2026-09-08" }, metrics: { spend: "1" } }] } }
      : { code: 0, message: "OK", data: { page_info: { page: 2, total_page: 2 }, list: [{ dimensions: { stat_time_day: "2026-09-09" }, metrics: { spend: "2" } }] } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const rows = await fetchTikTokAdsReport({
      accessToken: "access-token",
      advertiserId: "advertiser-1",
      startDate: "2026-09-08",
      endDate: "2026-09-09",
    });
    assert.equal(rows.length, 2);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url.pathname, "/open_api/v1.3/report/integrated/get/");
    assert.equal(requests[0].url.searchParams.get("report_type"), "BASIC");
    assert.equal(requests[0].url.searchParams.get("service_type"), "AUCTION");
    assert.equal(requests[0].url.searchParams.get("data_level"), "AUCTION_ADVERTISER");
    assert.deepEqual(JSON.parse(requests[0].url.searchParams.get("dimensions")), ["advertiser_id", "stat_time_day"]);
    assert.ok(JSON.parse(requests[0].url.searchParams.get("metrics")).includes("total_onsite_shopping_value"));
    assert.ok(JSON.parse(requests[0].url.searchParams.get("metrics")).includes("advertiser_name"));
    assert.equal(requests[0].url.searchParams.get("start_date"), "2026-09-08");
    assert.equal(requests[0].url.searchParams.get("end_date"), "2026-09-09");
    assert.equal(requests[0].init.headers["Access-Token"], "access-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TikTok Ads breakdown fetch requests the matching provider data level and identifier dimension", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input) => {
    request = new URL(String(input));
    return new Response(JSON.stringify({ code: 0, data: { page_info: { page: 1, total_page: 1 }, list: [] } }), { status: 200 });
  };
  try {
    await fetchTikTokAdsReport({ accessToken: "access-token", advertiserId: "advertiser-1", startDate: "2026-09-08", endDate: "2026-09-09", dataLevel: "AUCTION_AD" });
    assert.equal(request.searchParams.get("data_level"), "AUCTION_AD");
    assert.deepEqual(JSON.parse(request.searchParams.get("dimensions")), ["ad_id", "stat_time_day"]);
    assert.ok(JSON.parse(request.searchParams.get("metrics")).includes("ad_name"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TikTok Ads report fetch chunks daily ranges into provider-supported windows", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    requests.push(new URL(String(input)));
    return new Response(JSON.stringify({ code: 0, data: { page_info: { page: 1, total_page: 1 }, list: [] } }), { status: 200 });
  };
  try {
    await fetchTikTokAdsReport({ accessToken: "access-token", advertiserId: "advertiser-1", startDate: "2026-06-14", endDate: "2026-09-11" });
    assert.deepEqual(requests.map(request => [request.searchParams.get("start_date"), request.searchParams.get("end_date")]), [
      ["2026-06-14", "2026-07-13"],
      ["2026-07-14", "2026-08-12"],
      ["2026-08-13", "2026-09-11"],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TikTok Ads report fetch returns a safe error without echoing provider response data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 40100, message: "private provider detail" }), { status: 401 });
  try {
    await assert.rejects(
      fetchTikTokAdsReport({ accessToken: "access-token", advertiserId: "advertiser-1", startDate: "2026-09-08", endDate: "2026-09-09" }),
      (error) => error instanceof Error
        && error.message === "TikTok Ads reporting request failed (HTTP 401, code 40100)"
        && !error.message.includes("private provider detail"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
