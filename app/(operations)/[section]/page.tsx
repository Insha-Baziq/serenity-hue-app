import { notFound } from "next/navigation";

export default async function UpcomingPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section !== "overview") notFound();
  return (
    <section className="empty-state-page">
      <p className="eyebrow">Serenity Hue</p>
      <h1>Overview</h1>
      <p>This page is being set up.</p>
    </section>
  );
}
