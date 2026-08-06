import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, GraduationCap, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { SignupForm } from "@/components/signup-form";
import { getCurrentProfile } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Create student account" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const configured = isSupabaseConfigured();
  if (configured) {
    const profile = await getCurrentProfile();
    if (profile) redirect("/dashboard");
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-story-inner">
          <Logo />
          <div className="auth-story-copy">
            <div className="eyebrow light"><GraduationCap size={14} /> Student registration</div>
            <h1>Start your bidding journey.</h1>
            <p>Create your student account and enter the internship process with a clear point balance.</p>
            <ul>
              <li><CheckCircle2 /> Your student index stays linked to one account</li>
              <li><CheckCircle2 /> Any valid email address is accepted</li>
              <li><CheckCircle2 /> New students begin with 80 bidding points</li>
            </ul>
          </div>
          <div className="auth-security"><ShieldCheck /><span><strong>Passwords handled by Supabase Auth</strong>Credentials are never stored in the public profile table</span></div>
        </div>
      </section>
      <section className="auth-form-panel signup-panel">
        <div className="auth-form-wrap">
          <Link href="/" className="back-link"><ArrowLeft size={16} /> Back to home</Link>
          <div className="mobile-auth-logo"><Logo /></div>
          <div className="auth-form-heading">
            <span>CREATE YOUR ACCOUNT</span>
            <h2>Join InternBid</h2>
            <p>Enter the details registered with your university.</p>
          </div>
          {!configured && (
            <div className="setup-notice">
              <strong>Supabase setup required</strong>
              Copy <code>.env.example</code> to <code>.env.local</code> and add your project credentials.
            </div>
          )}
          <SignupForm configured={configured} />
          <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
