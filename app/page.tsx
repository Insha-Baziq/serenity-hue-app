import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth-guard";

export default async function Home() {
  const session = await getCurrentSession();
  redirect(session?.user ? "/overview" : "/login");
}
