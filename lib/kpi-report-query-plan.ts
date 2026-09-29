export type KpiReportScope = "product" | "customer" | "orders";
export type KpiDashboardScope = KpiReportScope | "full";

export type KpiReportQueryPlan = {
  customerHistory: boolean;
  customerSaleIdentity: boolean;
  productMapping: boolean;
  productInventory: boolean;
};

/** Selects the database source groups required to build one report without changing its metrics. */
export function getKpiReportQueryPlan(scope: KpiDashboardScope): KpiReportQueryPlan {
  return {
    customerHistory: scope === "customer" || scope === "full",
    customerSaleIdentity: scope === "customer" || scope === "full",
    productMapping: scope !== "customer",
    productInventory: scope === "product" || scope === "full",
  };
}
