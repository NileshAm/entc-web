"use client";

import { useActionState, useState } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { registerStudent } from "@/app/actions";
import type { ActionState } from "@/lib/types";

const initialState: ActionState = { ok: false, message: "" };

export function SignupForm({ configured, domain }: { configured: boolean; domain: string }) {
  const [state, action, pending] = useActionState(registerStudent, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  if (state.ok) {
    return (
      <div className="signup-success" role="status">
        <CheckCircle2 size={28} />
        <div>
          <strong>Account created</strong>
          <p>{state.message}</p>
        </div>
        <Link className="button button-primary" href="/login">
          Go to sign in <ArrowRight size={18} />
        </Link>
      </div>
    );
  }

  return (
    <form className="login-form signup-form" action={action}>
      <div className="signup-grid">
        <label>
          Full name
          <input
            name="fullName"
            type="text"
            autoComplete="name"
            placeholder="Nimal Perera"
            minLength={2}
            maxLength={100}
            required
            disabled={!configured || pending}
          />
        </label>
        <label>
          Student index
          <input
            name="registrationNumber"
            type="text"
            autoCapitalize="characters"
            placeholder="200012A"
            minLength={4}
            maxLength={30}
            pattern="[A-Za-z0-9/_-]+"
            title="Use letters, numbers, slashes, underscores or hyphens only"
            required
            disabled={!configured || pending}
          />
        </label>
      </div>
      <label>
        University email
        <input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={domain ? `you@${domain}` : "you@university.edu"}
          required
          disabled={!configured || pending}
        />
        {domain && <small className="field-hint">Only @{domain} addresses are accepted.</small>}
      </label>
      <label>
        Password
        <span className="password-field">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Create a secure password"
            minLength={8}
            maxLength={72}
            required
            disabled={!configured || pending}
            aria-describedby="password-requirements"
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
        <small className="field-hint" id="password-requirements">
          At least 8 characters with uppercase, lowercase, and a number.
        </small>
      </label>
      <label>
        Confirm password
        <span className="password-field">
          <input
            name="confirmPassword"
            type={showConfirmation ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Enter the password again"
            minLength={8}
            maxLength={72}
            required
            disabled={!configured || pending}
          />
          <button
            type="button"
            aria-label={showConfirmation ? "Hide password confirmation" : "Show password confirmation"}
            onClick={() => setShowConfirmation((value) => !value)}
          >
            {showConfirmation ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
      </label>
      {state.message && <div className="form-error" role="alert">{state.message}</div>}
      <button className="button button-primary login-submit" type="submit" disabled={!configured || pending}>
        {pending ? <LoaderCircle className="spin" size={18} /> : <>Create account <ArrowRight size={18} /></>}
      </button>
    </form>
  );
}
