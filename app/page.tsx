import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  Gavel,
  LockKeyhole,
  Radio,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getCurrentProfile } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

export default async function Home() {
  if (isSupabaseConfigured()) {
    const profile = await getCurrentProfile();
    if (profile) redirect("/dashboard");
  }

  return (
    <div className="marketing-page">
      <header className="marketing-nav page-container">
        <Logo />
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <Link href="/analytics">Live analytics</Link>
          <a href="#trust">Trust & safety</a>
        </nav>
        <Link className="button button-dark button-small" href="/login">
          Sign in <ArrowRight size={16} />
        </Link>
      </header>

      <main>
        <section className="hero page-container">
          <div className="hero-copy">
            <div className="eyebrow">
              <Sparkles size={15} /> University internship allocation, simplified
            </div>
            <h1>
              Bid smarter.
              <br />
              <span>Start stronger.</span>
            </h1>
            <p>
              A transparent, realtime home for internship company bidding—built
              for students, placement teams, and fair decisions.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/signup">
                Create student account <ArrowRight size={18} />
              </Link>
              <a className="button button-ghost" href="#how-it-works">
                See how it works
              </a>
            </div>
            <div className="hero-trust">
              <span><ShieldCheck size={17} /> Secure point balances</span>
              <span><Radio size={17} /> Live demand updates</span>
            </div>
          </div>

          <div className="hero-visual" aria-label="InternBid student dashboard preview">
            <div className="preview-orbit preview-orbit-one" />
            <div className="preview-orbit preview-orbit-two" />
            <div className="preview-card preview-main-card">
              <div className="preview-card-top">
                <div>
                  <small>OPEN NOW</small>
                  <strong>WSO2</strong>
                  <span>Software Engineering · Colombo</span>
                </div>
                <div className="company-monogram">W</div>
              </div>
              <div className="preview-demand">
                <div>
                  <small>Current bid</small>
                  <strong>25 <span>pts</span></strong>
                </div>
                <div>
                  <small>Live demand</small>
                  <strong>18 <span>/ 12 CVs</span></strong>
                </div>
              </div>
              <div className="demand-track"><span style={{ width: "82%" }} /></div>
              <button type="button">Review & apply <ArrowRight size={16} /></button>
            </div>
            <div className="preview-card preview-balance-card">
              <div className="preview-icon"><Gavel size={20} /></div>
              <div><small>AVAILABLE POINTS</small><strong>75</strong></div>
              <span className="positive-chip">+100 initial</span>
            </div>
            <div className="preview-card preview-live-card">
              <span className="live-dot" />
              <div><strong>Live update</strong><small>2 applicants just responded</small></div>
            </div>
          </div>
        </section>

        <section className="proof-strip">
          <div className="page-container proof-grid">
            <div><strong>&lt; 2 sec</strong><span>bid action updates</span></div>
            <div><strong>100%</strong><span>auditable point changes</span></div>
            <div><strong>300+</strong><span>concurrent students ready</span></div>
            <div><strong>24 / 7</strong><span>live status visibility</span></div>
          </div>
        </section>

        <section className="feature-section page-container" id="how-it-works">
          <div className="section-heading">
            <div className="eyebrow">One clear process</div>
            <h2>Everything you need to bid with confidence.</h2>
            <p>Know what is open, what it costs, and where every point went.</p>
          </div>
          <div className="feature-grid">
            <article>
              <div className="feature-icon mint"><Clock3 /></div>
              <span>01</span>
              <h3>See what is live</h3>
              <p>Open companies are highlighted with live applicant counts and deadlines.</p>
            </article>
            <article>
              <div className="feature-icon peach"><Gavel /></div>
              <span>02</span>
              <h3>Reserve your bid</h3>
              <p>Apply with a clear point preview. The database prevents overspending.</p>
            </article>
            <article>
              <div className="feature-icon lilac"><BellRing /></div>
              <span>03</span>
              <h3>Respond in realtime</h3>
              <p>Accept an increased bid or withdraw before the response timer expires.</p>
            </article>
            <article>
              <div className="feature-icon sky"><CheckCircle2 /></div>
              <span>04</span>
              <h3>Track the result</h3>
              <p>See every application, reservation, release, and finalized deduction.</p>
            </article>
          </div>
        </section>

        <section className="trust-section" id="trust">
          <div className="page-container trust-grid">
            <div>
              <div className="eyebrow light">Designed for high-stakes moments</div>
              <h2>Fair by design.<br />Fast by default.</h2>
              <p>Balances are enforced in PostgreSQL transactions—not trusted to a browser click.</p>
            </div>
            <div className="trust-cards">
              <div><LockKeyhole /><strong>Row-level privacy</strong><span>Students only see their own personal bidding data.</span></div>
              <div><DatabaseZap /><strong>Atomic finalization</strong><span>Every deduction succeeds together or rolls back.</span></div>
              <div><BarChart3 /><strong>Demand clarity</strong><span>Administrators see live, decision-ready metrics.</span></div>
              <div><UsersRound /><strong>Role-based control</strong><span>Student, administrator, and read-only access.</span></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="marketing-footer page-container">
        <Logo />
        <p>Batch Internship Company Bidding & CV Allocation System</p>
        <span>Built for transparent opportunities.</span>
      </footer>
    </div>
  );
}
