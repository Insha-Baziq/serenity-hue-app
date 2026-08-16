import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Serenity Hue Operations",
  description: "Private Shopify and TikTok Shop operations workspace.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
