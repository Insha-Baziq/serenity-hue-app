import "server-only";

import { unstable_cache } from "next/cache";
import { getKpiDashboard } from "@/lib/repository";
import type { KpiPeriod } from "@/lib/kpi-dashboard";
import type { KpiDashboardScope } from "@/lib/kpi-report-query-plan";
import { KPI_REPORTING_CACHE_SECONDS, KPI_REPORTING_CACHE_TAG } from "@/lib/kpi-reporting-cache-constants";

export { KPI_REPORTING_CACHE_SECONDS, KPI_REPORTING_CACHE_TAG } from "@/lib/kpi-reporting-cache-constants";

export const getCachedKpiDashboard = unstable_cache(
  async (range: KpiPeriod, scope: KpiDashboardScope = "full") => getKpiDashboard(range, undefined, { scope }),
  ["kpi-dashboard-v3"],
  { revalidate: KPI_REPORTING_CACHE_SECONDS, tags: [KPI_REPORTING_CACHE_TAG] },
);
