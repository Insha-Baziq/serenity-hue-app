import "server-only";

import { unstable_cache } from "next/cache";
import { getKpiDashboard } from "@/lib/repository";
import type { KpiPeriod } from "@/lib/kpi-dashboard";
import { KPI_REPORTING_CACHE_SECONDS, KPI_REPORTING_CACHE_TAG } from "@/lib/kpi-reporting-cache-constants";

export { KPI_REPORTING_CACHE_SECONDS, KPI_REPORTING_CACHE_TAG } from "@/lib/kpi-reporting-cache-constants";

export const getCachedKpiDashboard = unstable_cache(
  async (range: KpiPeriod) => getKpiDashboard(range),
  ["kpi-dashboard-v2"],
  { revalidate: KPI_REPORTING_CACHE_SECONDS, tags: [KPI_REPORTING_CACHE_TAG] },
);
