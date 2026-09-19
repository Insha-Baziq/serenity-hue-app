"use client";

import { Eye, EyeOff, LockKeyhole, Mail, ArrowRight } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
        rememberMe,
      });

      if (result.error) {
        setError(result.error.message || "Those details were not recognised. Try again.");
        return;
      }

      router.replace(returnTo ?? "/orders");
    } catch {
      setError("We could not sign you in right now. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="login-form__intro animate-element animate-delay-100">
        <span className="login-form__eyebrow">Private workspace</span>
        <h1>Welcome back</h1>
        <p>Sign in to continue to your operations workspace.</p>
      </div>

      <div className="login-form__fields">
        <label className="login-field animate-element animate-delay-300">
          <span>Email address</span>
          <span className="login-field__control">
            <Mail size={18} strokeWidth={1.7} aria-hidden="true" />
            <input
              autoComplete="email"
              name="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </span>
        </label>

        <label className="login-field animate-element animate-delay-400">
          <span>Password</span>
          <span className="login-field__control">
            <LockKeyhole size={18} strokeWidth={1.7} aria-hidden="true" />
            <input
              autoComplete="current-password"
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              className="login-field__toggle"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
            </button>
          </span>
        </label>
      </div>

      <div className="login-form__options animate-element animate-delay-500">
        <label className="login-checkbox">
          <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
          <span className="login-checkbox__mark" aria-hidden="true" />
          <span>Remember me</span>
        </label>
        <span className="login-form__forgot">Forgot password?</span>
      </div>

      {error && <p className="login-form__error animate-element" role="alert">{error}</p>}

      <button className="login-submit animate-element animate-delay-600" type="submit" disabled={pending}>
        <span>{pending ? "Signing in…" : "Sign in"}</span>
        <ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>

    </form>
  );
}
