import assert from "node:assert/strict";
import test from "node:test";
import { resolveReportingPeriod } from "../lib/reporting-period.ts";

test("reporting periods default to the last 30 London calendar days and expose the preceding 30 days", () => {
  const period = resolveReportingPeriod({}, new Date("2026-09-13T12:00:00.000Z"));

  assert.deepEqual(period.range, { start: "2026-08-15", end: "2026-09-13" });
  assert.deepEqual(period.comparison, { start: "2026-07-16", end: "2026-08-14" });
});

test("reporting periods retain valid custom and all-time selections", () => {
  assert.deepEqual(
    resolveReportingPeriod({ start: "2026-09-01", end: "2026-09-07" }, new Date("2026-09-13T12:00:00.000Z")),
    { range: { start: "2026-09-01", end: "2026-09-07" }, comparison: { start: "2026-08-25", end: "2026-08-31" } },
  );
  assert.deepEqual(
    resolveReportingPeriod({ period: "all" }, new Date("2026-09-13T12:00:00.000Z")),
    { range: { start: "2026-09-13", end: "2026-09-13", allTime: true }, comparison: null },
  );
});
