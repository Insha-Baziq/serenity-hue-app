import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Complete staff invitation | Serenity Hue",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function EmployeeInvitationPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--canvas, #fcfaf8)", padding: 24 }}>
      <Card style={{ width: "100%", maxWidth: 440 }}>
        <CardHeader>
          <CardTitle>Set up your Serenity Hue account</CardTitle>
          <CardDescription>Choose a password to accept your staff invitation. This link can be used once and expires after 24 hours.</CardDescription>
        </CardHeader>
        <CardContent>
          {error === "password" && <p role="alert" style={{ color: "#c84954" }}>Passwords must match and contain 8 to 128 characters.</p>}
          {error === "expired" && <p role="alert" style={{ color: "#c84954" }}>This invitation is expired or has already been used. Ask for a new invitation.</p>}
          <form action="/api/employees/accept-invite" method="post" style={{ display: "grid", gap: 16 }}>
            <input type="hidden" name="token" value={token} />
            <label style={{ display: "grid", gap: 6 }}>
              Password
              <Input name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Confirm password
              <Input name="confirmation" type="password" minLength={8} maxLength={128} autoComplete="new-password" required />
            </label>
            <Button type="submit" variant="primary">Complete setup</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
