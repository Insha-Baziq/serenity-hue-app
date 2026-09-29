import { unstable_cache } from "next/cache";
import { ActivityLogWorkspace } from "@/components/activity-log-workspace";
import { parseActivityLogQuery } from "@/lib/activity-log-query";
import { ACTIVITY_LOG_CACHE_TAG, getActivityLogPage } from "@/lib/repository";
import { requirePageSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

const getCachedActivityLogPage = unstable_cache(
  async (serializedQuery: string) => getActivityLogPage(JSON.parse(serializedQuery)),
  ["activity-log-page"],
  { revalidate: 30, tags: [ACTIVITY_LOG_CACHE_TAG] },
);

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageSession();
  const query = parseActivityLogQuery(await searchParams);
  const page = await getCachedActivityLogPage(JSON.stringify(query));
  return <ActivityLogWorkspace page={page} query={{ ...query, page: page.page, pageSize: page.pageSize }} />;
}
