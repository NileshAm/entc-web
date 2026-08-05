"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/env";

export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handlePasswordLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: String(data.get("email")),
      password: String(data.get("password")),
    });
    if (signInError) {
      setError(signInError.message);
      setPending(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function handleGoogleLogin() {
    if (!configured) return;
    setPending(true);
    setError("");
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${getSiteUrl()}/auth/callback` },
    });
    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handlePasswordLogin}>
      <button className="google-button" type="button" onClick={handleGoogleLogin} disabled={!configured || pending}>
        <span className="google-g">G</span> Continue with Google
      </button>
      <div className="form-divider"><span>or use email</span></div>
      <label>
        University email
        <input name="email" type="email" autoComplete="email" placeholder="you@university.edu" required disabled={!configured} />
      </label>
      <label>
        Password
        <span className="password-field">
          <input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" required minLength={6} disabled={!configured} />
          <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="button button-primary login-submit" type="submit" disabled={!configured || pending}>
        {pending ? <LoaderCircle className="spin" size={18} /> : <>Sign in <ArrowRight size={18} /></>}
      </button>
    </form>
  );
}
