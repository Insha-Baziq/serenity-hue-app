import Image from "next/image";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentSession } from "@/lib/auth-guard";

export const metadata = {
  title: "Sign in | Serenity Hue Operations",
  description: "Sign in to the Serenity Hue operations workspace.",
};

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ returnTo?: string }> }) {
  const session = await getCurrentSession();
  const requestedReturnTo = (await searchParams)?.returnTo;
  const returnTo = requestedReturnTo?.startsWith("/") && !requestedReturnTo.startsWith("//") ? requestedReturnTo : undefined;
  if (session?.user) redirect(returnTo ?? "/overview");

  return (
    <main className="login-shell">
      <section className="login-art" aria-label="Serenity Hue beauty campaign">
        <Image
          className="login-art__image"
          src="/serenity-hue-login-portrait.png"
          alt="Woman holding a Serenity Hue-inspired serum bottle"
          fill
          priority
          sizes="(max-width: 820px) 100vw, 45vw"
        />
        <div className="login-art__wash" />
        <div className="login-art__content">
          <div className="login-art__message">
            <span>Beauty, thoughtfully managed.</span>
            <p>A calmer way to keep every channel, order, and detail in view.</p>
          </div>
        </div>
        <div className="login-art__floaters" aria-label="Workspace highlights">
          <div className="login-glass-card animate-testimonial animate-delay-800">
            <span className="login-glass-card__mark">SH</span>
            <span><strong>Live channels</strong><small>Shopify · TikTok Shop</small></span>
          </div>
          <div className="login-glass-card login-glass-card--secondary animate-testimonial animate-delay-1000">
            <span className="login-glass-card__pulse" aria-hidden="true" />
            <span><strong>Delivery matching</strong><small>Parcel2Go in sync</small></span>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <Image className="login-panel__logo" src="/serenity-hue-login-logo.png" alt="Serenity Hue by Shabina" width={170} height={170} priority />
        <LoginForm returnTo={returnTo} />
      </section>
    </main>
  );
}
