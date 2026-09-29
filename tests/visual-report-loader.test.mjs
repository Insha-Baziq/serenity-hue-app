import assert from "node:assert/strict";
import test from "node:test";
import { loadVisualReport, resolveVisualReportId } from "../lib/visual-report-loader.ts";

const range = { start: "2026-08-01", end: "2026-08-31" };

function loaders(calls) {
  return {
    kpi: async (requestedRange, scope) => {
      calls.push(["kpi", requestedRange, scope]);
      return { source: "kpi" };
    },
    ads: async (requestedRange) => {
      calls.push(["ads", requestedRange]);
      return { source: "ads" };
    },
    affiliate: async (requestedRange) => {
      calls.push(["affiliate", requestedRange]);
      return { source: "affiliate" };
    },
  };
}

test("each visual report loads only its own report dataset and preserves the requested range", async (t) => {
  const cases = [
    ["product", ["kpi", range, "product"]],
    ["customer", ["kpi", range, "customer"]],
    ["orders", ["kpi", range, "orders"]],
    ["ads", ["ads", range]],
    ["affiliate", ["affiliate", range]],
  ];

  for (const [report, expectedCall] of cases) {
    await t.test(report, async () => {
      const calls = [];
      const result = await loadVisualReport(report, range, loaders(calls));

      assert.deepEqual(calls, [expectedCall]);
      assert.equal(result.report, report);
      assert.strictEqual(calls[0][1], range);
    });
  }
});

test("report selection accepts only known report ids and otherwise keeps the product default", () => {
  assert.equal(resolveVisualReportId("ads"), "ads");
  assert.equal(resolveVisualReportId("affiliate"), "affiliate");
  assert.equal(resolveVisualReportId(["ads", "affiliate"]), "product");
  assert.equal(resolveVisualReportId("unknown"), "product");
  assert.equal(resolveVisualReportId(undefined), "product");
});
