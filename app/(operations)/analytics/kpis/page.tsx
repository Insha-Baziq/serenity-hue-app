import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth-guard";

export default async function AnalyticsKpisPage() {
  await requirePageSession();
  redirect("/kpis");
}
