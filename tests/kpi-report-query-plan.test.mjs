import assert from "node:assert/strict";
import test from "node:test";
import { getKpiReportQueryPlan } from "../lib/kpi-report-query-plan.ts";

test("KPI report scopes select only the source groups used by that report", () => {
  assert.deepEqual(getKpiReportQueryPlan("product"), {
    customerHistory: false,
    customerSaleIdentity: false,
    productMapping: true,
    productInventory: true,
  });
  assert.deepEqual(getKpiReportQueryPlan("customer"), {
    customerHistory: true,
    customerSaleIdentity: true,
    productMapping: false,
    productInventory: false,
  });
  assert.deepEqual(getKpiReportQueryPlan("orders"), {
    customerHistory: false,
    customerSaleIdentity: false,
    productMapping: true,
    productInventory: false,
  });
  assert.deepEqual(getKpiReportQueryPlan("full"), {
    customerHistory: true,
    customerSaleIdentity: true,
    productMapping: true,
    productInventory: true,
  });
});
