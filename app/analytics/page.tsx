import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  ChevronDown,
  Eye,
  Gavel,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Countdown } from "@/components/countdown";
import { PublicAnalyticsRealtime } from "@/components/public-analytics-realtime";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime, participantRankingLabel } from "@/lib/business";
import { getPublicBidAnalytics } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import type { BidParticipant, PublicCompanyAnalytics } from "@/lib/types";

export const metadata: Metadata = {
  title: "Public bidding analytics",
  description: "Live internship company bids, demand, and current applicant status.",
};

export const dynamic = "force-dynamic";

const completedParticipantStates: BidParticipant["response_state"][] = [
  "withdrawn",
  "not_selected",
  "selected",
  "finalized",
];

function participantTone(participant: BidParticipant) {
  if (completedParticipantStates.includes(participant.response_state)) {
    return participant.response_state;
  }
  return participant.is_currently_selected ? participant.response_state : "pending";
}

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
  const liveParticipants = liveCompany?.participants ?? [];
  const activeBidders = liveParticipants.filter((participant) =>
    ["staying", "pending"].includes(participant.response_state),
  );
  const completedBidders = liveParticipants.length - activeBidders.length;
  const otherCompanies = companies.filter((company) => company.id !== liveCompany?.id);
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
          Sign in <ArrowRight size={17} />
        </Link>
      </header>

      <main className="public-analytics-main page-container">
        <section className="public-focus" aria-labelledby="live-session-title">
          <header className="public-focus-intro">
            <div>
              <div className="eyebrow"><Eye size={16} /> Public bidding view</div>
              <h1 id="live-session-title">Live bidding, <span>at a glance.</span></h1>
              <p>The current company, bid, available positions, timer, and complete bidder list are kept together for quick decisions.</p>
            </div>
            {configured && !unavailable && <PublicAnalyticsRealtime />}
          </header>

          {!configured && (
            <div className="setup-notice public-analytics-notice">
              <strong>Supabase setup required</strong>
              Add the project credentials before loading public analytics.
            </div>
          )}
          {unavailable && (
            <div className="setup-notice public-analytics-notice">
              <strong>Public analytics is not ready</strong>
              Apply the latest Supabase migration to load the live company summary.
            </div>
          )}

          <article className={`public-focus-card ${liveCompany ? "active" : ""}`}>
            {liveCompany ? (
              <>
                <div className="public-focus-overview">
                  <div className="public-live-card-head">
                    <span><span className="live-dot" /> CURRENT BIDDING COMPANY</span>
                    <StatusBadge status={liveCompany.status} />
                  </div>

                  <div className="public-company-heading">
                    <h2>{liveCompany.name}</h2>
                    <p>{liveCompany.industry} · {liveCompany.location}</p>
                  </div>

                  <div className="public-role-block">
                    <span>POSITIONS OFFERED</span>
                    <div className="public-role-list">
                      {liveCompany.available_roles.length
                        ? liveCompany.available_roles.map((role) => <strong key={role}>{role}</strong>)
                        : <strong>Internship roles to be confirmed</strong>}
                    </div>
                  </div>

                  <div className="public-current-bid">
                    <span>{liveCompany.bidding_mode === "automatic" ? "Highest bid right now" : "Current bidding amount"}</span>
                    <strong>{liveCompany.current_bid}<small> points</small></strong>
                  </div>

                  <div className="public-live-facts">
                    <span><Users /><strong>{activeBidders.length}</strong>Active bidders</span>
                    <span><BriefcaseBusiness /><strong>{liveCompany.cv_requirement}</strong>Available positions</span>
                    <span><BarChart3 /><strong>{liveCompany.demand_ratio.toFixed(2)}×</strong>Demand</span>
                    <span><Gavel /><strong>{liveCompany.bidding_mode === "automatic" ? "Automatic" : "Committee"}</strong>Bidding method</span>
                  </div>

                  {liveCompany.bidding_mode === "automatic" && liveCompany.auto_closes_at && liveCompany.status === "open" && (
                    <div className="public-auto-close">
                      <CalendarClock />
                      <span><small>SESSION CLOSES AFTER INACTIVITY</small><strong><Countdown deadline={liveCompany.auto_closes_at} /></strong></span>
                    </div>
                  )}
                </div>

                <section className="public-focus-roster" aria-label={`${liveCompany.name} bidder list`}>
                  <header>
                    <div>
                      <span className="page-kicker">BIDDER NAME LIST</span>
                      <h3>Everyone remains visible</h3>
                      <p>{activeBidders.length} active · {completedBidders} withdrawn or completed</p>
                    </div>
                    <span className="public-roster-count">{liveParticipants.length}</span>
                  </header>
                  {liveParticipants.length ? (
                    <ul className="public-focus-participants">
                      {liveParticipants.map((participant, index) => (
                        <li
                          key={`${participant.full_name}-${index}`}
                          className={completedParticipantStates.includes(participant.response_state) ? "inactive" : ""}
                        >
                          <span className="participant-avatar" aria-hidden="true">{participant.full_name.charAt(0).toUpperCase()}</span>
                          <span><strong>{participant.full_name}</strong><small>{participantRankingLabel(participant, liveCompany.bidding_mode, liveCompany.cv_requirement)}</small></span>
                          <b className={participantTone(participant)}>{participant.response_state === "pending" ? "Responding" : participant.response_state.replaceAll("_", " ")}</b>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="participant-empty">No applications have been submitted for this company.</p>
                  )}
                  <div className="public-roster-note">
                    <ShieldCheck /> Withdrawn and not-selected bidders stay listed with their final status.
                  </div>
                </section>
              </>
            ) : (
              <div className="public-no-live">
                <Gavel />
                <h2>No bidding session is live</h2>
                <p>Upcoming companies, schedules, and previous bidder outcomes remain available below.</p>
              </div>
            )}
          </article>

          {configured && !unavailable && (
            <a className="public-scroll-cue" href="#all-company-insights">
              All company insights <ChevronDown />
            </a>
          )}
        </section>

        {!unavailable && configured && (
          <section className="public-secondary" id="all-company-insights">
            <div className="public-secondary-heading">
              <span className="page-kicker">ALL COMPANY DATA</span>
              <h2>Compare the wider bidding picture</h2>
              <p>Aggregate demand, schedules, and other company rosters are kept below the live session.</p>
            </div>

            <section className="public-metric-grid compact" aria-label="Overall bidding totals">
              <article><span className="metric-icon blue"><Building2 /></span><div><small>PUBLIC COMPANIES</small><strong>{companies.length}</strong><p>Cancelled listings excluded</p></div></article>
              <article><span className="metric-icon purple"><Users /></span><div><small>ACTIVE APPLICANTS</small><strong>{totalApplicants}</strong><p>Across current sessions</p></div></article>
              <article><span className="metric-icon amber"><BriefcaseBusiness /></span><div><small>AVAILABLE POSITIONS</small><strong>{totalSlots}</strong><p>Total CV openings</p></div></article>
            </section>

            <section className="public-panel public-chart-card">
              <div className="section-title-row">
                <div><span className="page-kicker">AGGREGATED DEMAND</span><h2>Applicants vs. available positions</h2></div>
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
              <div className="chart-legend"><span><i className="legend-applicants" /> Applicants</span><span><i className="legend-slots" /> Positions</span></div>
            </section>

            <section className="public-panel public-company-table">
              <div className="section-title-row">
                <div><span className="page-kicker">COMPANY BREAKDOWN</span><h2>Current public statistics</h2></div>
              </div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead><tr><th>Company</th><th>Method</th><th>Status</th><th>{"Current / highest bid"}</th><th>Maximum</th><th>Applicants</th><th>Positions</th><th>Demand</th><th>Closes</th></tr></thead>
                  <tbody>
                    {companies.map((company) => (
                      <tr key={company.id}>
                        <td><strong>{company.name}</strong><small className="public-company-meta">{company.industry} · {company.location}</small></td>
                        <td>{company.bidding_mode === "automatic" ? "Automatic" : "Committee"}</td>
                        <td><StatusBadge status={company.status} /></td>
                        <td><strong>{company.current_bid} pts</strong></td>
                        <td>{company.maximum_bid ? `${company.maximum_bid} pts` : "—"}</td>
                        <td>{company.applicant_count}</td>
                        <td>{company.cv_requirement}</td>
                        <td><strong className={company.demand_ratio > 1 ? "danger-text" : ""}>{company.demand_ratio.toFixed(2)}×</strong></td>
                        <td>{company.bidding_mode === "automatic" && company.auto_closes_at ? <Countdown deadline={company.auto_closes_at} /> : formatDateTime(company.closes_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {otherCompanies.length > 0 && (
              <section className="public-panel public-applicants-panel">
                <div className="section-title-row">
                  <div><span className="page-kicker">OTHER BID ROSTERS</span><h2>Bidder outcomes by company</h2></div>
                  <Users />
                </div>
                <div className="public-applicant-grid">
                  {otherCompanies.map((company) => (
                    <article key={company.id} className="public-applicant-company">
                      <header>
                        <span><strong>{company.name}</strong><small>{company.participants.length} {company.status === "registration_open" ? "registered students" : "recorded bidders"} · {company.cv_requirement} positions</small></span>
                        <StatusBadge status={company.status} />
                      </header>
                      {company.participants.length ? (
                        <ul className="public-participant-list">
                          {company.participants.map((participant, index) => (
                            <li key={`${participant.full_name}-${index}`} className={completedParticipantStates.includes(participant.response_state) ? "inactive" : ""}>
                              <span className="participant-avatar" aria-hidden="true">{participant.full_name.charAt(0).toUpperCase()}</span>
                              <span>{participant.full_name}</span>
                              <small className={participantTone(participant)}>
                                {company.status === "registration_open" && participant.response_state !== "withdrawn"
                                  ? `${participant.bid_amount} pts reserved · ${company.bidding_mode === "automatic" ? "Initial bid" : "Registered"}`
                                  : participantRankingLabel(participant, company.bidding_mode, company.cv_requirement)}
                              </small>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="participant-empty">No applications have been submitted for this company.</p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            <aside className="public-privacy-banner">
              <ShieldCheck />
              <div>
                <strong>Privacy-safe public view</strong>
                <span>Only applicant names and bidding states are public. Emails, student numbers, balances, staff records, audit logs, and internal notes remain private.</span>
              </div>
            </aside>
          </section>
        )}
      </main>

      <footer className="marketing-footer page-container">
        <Logo />
        <p>Public bidding data includes current applicant names, status, and automatic-auction rankings.</p>
        <Link href="/">InternBid home</Link>
      </footer>
    </div>
  );
}
