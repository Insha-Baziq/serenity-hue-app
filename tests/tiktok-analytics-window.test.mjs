import assert from "node:assert/strict";
import test from "node:test";
import { tiktokAffiliateAnalyticsWindow } from "../lib/tiktok-analytics-window.ts";

test("TikTok affiliate analytics window uses London calendar dates and an exclusive end date", () => {
  assert.deepEqual(
    tiktokAffiliateAnalyticsWindow(new Date("2026-03-29T00:30:00.000Z")),
    { startDateGe: "2025-12-29", endDateLt: "2026-03-30" },
  );
});
