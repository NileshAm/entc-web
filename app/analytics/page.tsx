import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarClock,
  Eye,
  Gavel,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { PublicAnalyticsRealtime } from "@/components/public-analytics-realtime";
import { StatusBadge } from "@/components/status-badge";
import { demandCategory, formatDateTime } from "@/lib/business";
import { getPublicBidAnalytics } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import type { PublicCompanyAnalytics } from "@/lib/types";

export const metadata: Metadata = {
  title: "Public bidding analytics",
  description: "Live, privacy-safe internship company bid and demand statistics.",
};

export const dynamic = "force-dynamic";

export default async function PublicAnalyticsPage() {
  const configured = isSupabaseConfigured();
  let companies: PublicCompanyAnalytics[] = [];
  let unavailable = false;

  if (configured) {
    try {
      companies = await getPublicBidAnalytics();
    } catch {
      unavailable = true;
    }
  }

  const liveCompany = companies.find((company) =>
    ["open", "bid_increase_pending", "paused"].includes(company.status),
  );
  const totalApplicants = companies.reduce((sum, company) => sum + company.applicant_count, 0);
  const totalSlots = companies.reduce((sum, company) => sum + company.cv_requirement, 0);
  const maxDemand = Math.max(
    1,
    ...companies.flatMap((company) => [company.applicant_count, company.cv_requirement]),
  );

  return (
    <div className="public-analytics-page">
      <header className="marketing-nav public-analytics-nav page-container">
        <Logo />
        <nav aria-label="Public navigation">
          <Link href="/">Home</Link>
          <Link href="/analytics" aria-current="page">Live analytics</Link>
        </nav>
        <Link className="button button-dark button-small" href="/login">
          Sign in <ArrowRight size={16} />
        </Link>
      </header>

      <main className="public-analytics-main page-container">
        <section className="public-analytics-hero">
          <div>
            <div className="eyebrow"><Eye size={15} /> Public bidding view</div>
            <h1>Current bids.<br /><span>Clear demand.</span></h1>
            <p>Follow company bids and aggregated demand without exposing student, committee, or administrator records.</p>
            {configured && !unavailable && <PublicAnalyticsRealtime />}
          </div>
          <article className={`public-live-card ${liveCompany ? "active" : ""}`}>
            <div className="public-live-card-head">
              <span><span className="live-dot" /> {liveCompany ? "CURRENT SESSION" : "BIDDING STATUS"}</span>
              {liveCompany && <StatusBadge status={liveCompany.status} />}
            </div>
            {liveCompany ? (
              <>
                <h2>{liveCompany.name}</h2>
                <p>{liveCompany.industry} · {liveCompany.location}</p>
                <div className="public-current-bid">
                  <span>Current bid</span>
                  <strong>{liveCompany.current_bid}<small> points</small></strong>
                </div>
                <div className="public-live-facts">
                  <span><strong>{liveCompany.applicant_count}</strong>Applicants</span>
                  <span><strong>{liveCompany.cv_requirement}</strong>CV slots</span>
                  <span><strong>{liveCompany.demand_ratio.toFixed(2)}×</strong>Demand</span>
                </div>
              </>
            ) : (
              <div className="public-no-live">
                <Gavel />
                <h2>No bidding session is live</h2>
                <p>Upcoming companies and their schedules remain visible below.</p>
              </div>
            )}
          </article>
        </section>

        {!configured && (
          <div className="setup-notice public-analytics-notice">
            <strong>Supabase setup required</strong>
            Add the project credentials before loading public analytics.
          </div>
        )}
        {unavailable && (
          <div className="setup-notice public-analytics-notice">
            <strong>Public analytics is not ready</strong>
            Apply the latest Supabase migration to install the privacy-safe analytics function.
          </div>
        )}

        {!unavailable && configured && (
          <>
            <section className="public-metric-grid">
              <article><span className="metric-icon blue"><Building2 /></span><div><small>PUBLIC COMPANIES</small><strong>{companies.length}</strong><p>Cancelled listings excluded</p></div></article>
              <article><span className="metric-icon purple"><Users /></span><div><small>APPLICANTS</small><strong>{totalApplicants}</strong><p>Aggregated count only</p></div></article>
              <article><span className="metric-icon amber"><CalendarClock /></span><div><small>CV SLOTS</small><strong>{totalSlots}</strong><p>Across visible companies</p></div></article>
              <article className="emphasis"><span className="metric-icon"><Gavel /></span><div><small>LIVE BID</small><strong>{liveCompany ? liveCompany.current_bid : "—"}</strong><p>{liveCompany?.name ?? "No active session"}</p></div></article>
            </section>

            <section className="public-privacy-banner">
              <ShieldCheck />
              <div>
                <strong>Privacy-safe by design</strong>
                <span>This page never receives names, emails, index numbers, point balances, staff records, audit logs, contacts, or internal notes.</span>
              </div>
            </section>

            <div className="public-analytics-grid">
              <section className="public-panel public-chart-card">
                <div className="section-title-row">
                  <div><span className="page-kicker">AGGREGATED DEMAND</span><h2>Applicants vs. CV slots</h2></div>
                  <BarChart3 />
                </div>
                {companies.length ? (
                  <div className="bar-chart">
                    {companies.slice(0, 10).map((company) => (
                      <div key={company.id} className="bar-row">
                        <span>{company.name}</span>
                        <div className="bar-track">
                          <i className="slots-bar" style={{ width: `${company.cv_requirement / maxDemand * 100}%` }} />
                          <i className={`applicants-bar ${company.demand_ratio > 1 ? "over" : ""}`} style={{ width: `${company.applicant_count / maxDemand * 100}%` }} />
                        </div>
                        <strong>{company.applicant_count}/{company.cv_requirement}</strong>
                      </div>
                    ))}
                  </div>
                ) : <div className="empty-list">No public company statistics yet.</div>}
                <div className="chart-legend"><span><i className="legend-applicants" /> Applicants</span><span><i className="legend-slots" /> CV slots</span></div>
              </section>

              <section className="public-panel public-demand-summary">
                <span className="page-kicker">DEMAND SNAPSHOT</span>
                {companies.length ? [...companies]
                  .sort((first, second) => second.demand_ratio - first.demand_ratio)
                  .slice(0, 4)
                  .map((company) => (
                    <article key={company.id}>
                      <div><strong>{company.name}</strong><span>{demandCategory(company.demand_ratio)}</span></div>
                      <b className={company.demand_ratio > 1 ? "danger-text" : ""}>{company.demand_ratio.toFixed(2)}×</b>
                    </article>
                  )) : <p>No demand data yet.</p>}
              </section>
            </div>

            <section className="public-panel public-company-table">
              <div className="section-title-row">
                <div><span className="page-kicker">COMPANY BREAKDOWN</span><h2>Current public statistics</h2></div>
              </div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead><tr><th>Company</th><th>Status</th><th>Current bid</th><th>Applicants</th><th>CV slots</th><th>Demand</th><th>Closes</th></tr></thead>
                  <tbody>
                    {companies.map((company) => (
                      <tr key={company.id}>
                        <td><strong>{company.name}</strong><small className="public-company-meta">{company.industry} · {company.location}</small></td>
                        <td><StatusBadge status={company.status} /></td>
                        <td><strong>{company.current_bid} pts</strong></td>
                        <td>{company.applicant_count}</td>
                        <td>{company.cv_requirement}</td>
                        <td><strong className={company.demand_ratio > 1 ? "danger-text" : ""}>{company.demand_ratio.toFixed(2)}×</strong></td>
                        <td>{formatDateTime(company.closes_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="marketing-footer page-container">
        <Logo />
        <p>Public statistics contain aggregated company bidding data only.</p>
        <Link href="/">InternBid home</Link>
      </footer>
    </div>
  );
}
