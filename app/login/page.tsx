import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Radio, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { LoginForm } from "@/components/login-form";
import { getCurrentProfile } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (isSupabaseConfigured()) {
    const profile = await getCurrentProfile();
    if (profile) redirect("/dashboard");
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-story-inner">
          <Logo />
          <div className="auth-story-copy">
            <div className="eyebrow light"><Radio size={14} /> Live bidding portal</div>
            <h1>Your next opportunity is waiting.</h1>
            <p>Make informed bids, protect your points, and follow every result in realtime.</p>
            <ul>
              <li><CheckCircle2 /> Clear point reservations before you confirm</li>
              <li><CheckCircle2 /> Instant Stay or Withdraw notifications</li>
              <li><CheckCircle2 /> A complete, private activity history</li>
            </ul>
          </div>
          <div className="auth-security"><ShieldCheck /><span><strong>Protected by Supabase Auth</strong>Secure sessions and row-level data access</span></div>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <Link href="/" className="back-link"><ArrowLeft size={16} /> Back to home</Link>
          <div className="mobile-auth-logo"><Logo /></div>
          <div className="auth-form-heading">
            <span>WELCOME BACK</span>
            <h2>Sign in to InternBid</h2>
            <p>Use your email and password to continue.</p>
          </div>
          {!isSupabaseConfigured() && (
            <div className="setup-notice">
              <strong>Supabase setup required</strong>
              Copy <code>.env.example</code> to <code>.env.local</code> and add your project credentials.
            </div>
          )}
          <LoginForm configured={isSupabaseConfigured()} />
          <p className="auth-switch">New to InternBid? <Link href="/signup">Create your student account</Link></p>
          <p className="auth-help">Can’t access your account? Contact the internship bidding committee.</p>
        </div>
      </section>
    </main>
  );
}
