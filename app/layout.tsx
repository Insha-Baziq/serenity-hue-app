import type { Metadata } from "next";
import { DM_Sans, Source_Serif_4 } from "next/font/google";
import "@/app/globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  fallback: ["Segoe UI", "Arial", "sans-serif"],
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const metadata: Metadata = {
  title: "Serenity Hue Operations",
  description: "Private Shopify and TikTok Shop operations workspace.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${sourceSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
