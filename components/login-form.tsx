"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
      setError("Invalid email or password.");
      setPending(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form className="login-form" onSubmit={handlePasswordLogin}>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required disabled={!configured} />
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
