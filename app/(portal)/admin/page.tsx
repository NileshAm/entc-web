import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CircleDollarSign,
  Gavel,
  Hourglass,
  Trophy,
  Users,
  UserRoundCheck,
} from "lucide-react";
import Link from "next/link";
import { AdminCompanyControls } from "@/components/admin-company-controls";
import { CompanyAvatar } from "@/components/company-avatar";
import { Countdown } from "@/components/countdown";
import { CsvExport } from "@/components/csv-export";
import { ManualRoundTimer } from "@/components/manual-round-timer";
import { StatusBadge } from "@/components/status-badge";
import { requireProfile } from "@/lib/auth";
import { demandCategory, formatDateTime, formatStatus, initials } from "@/lib/business";
import { getAdminOverviewData } from "@/lib/data";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ results?: string | string[] }>;
}) {
  const query = await searchParams;
  const resultCompanyId = typeof query.results === "string" ? query.results : null;
  const profile = await requireProfile(["admin", "viewer"]);
  const { companies, applications } = await getAdminOverviewData();
  const live = companies.find((company) =>
    ["open", "paused", "bid_increase_pending"].includes(company.status),
  );
  const active = applications
    .filter((application) =>
      ["active_bid", "confirmation_required", "confirmed", "selected"].includes(application.status),
    )
    .sort((left, right) =>
      new Date(right.bid_updated_at ?? right.applied_at).getTime() -
      new Date(left.bid_updated_at ?? left.applied_at).getTime(),
    );
  const responseDeadline = live?.manual_round_deadline ?? active
    .filter((application) =>
      application.company_id === live?.id &&
      ["confirmation_required", "confirmed"].includes(application.status) &&
      application.confirmation_deadline,
    )
    .map((application) => application.confirmation_deadline as string)
    .reduce<string | null>((latest, deadline) =>
      latest === null || new Date(deadline).getTime() > new Date(latest).getTime()
        ? deadline
        : latest,
    null);
  const finalizedCompanies = companies
    .filter((company) => company.status === "finalized")
    .sort((left, right) =>
      new Date(right.finalized_at ?? 0).getTime() -
      new Date(left.finalized_at ?? 0).getTime(),
    );
  const resultCompany = finalizedCompanies.find((company) => company.id === resultCompanyId)
    ?? finalizedCompanies[0]
    ?? null;
  const resultApplications = resultCompany
    ? applications.filter((application) => application.company_id === resultCompany.id)
    : [];
  const selectedResults = resultApplications.filter((application) =>
    ["selected", "finalized"].includes(application.status),
  );
  const withdrawnResults = resultApplications.filter((application) =>
    application.status === "withdrawn",
  );
  const notSelectedResults = resultApplications.filter((application) =>
    application.status === "not_selected",
  );
  const outcomeRows = resultApplications
    .filter((application) =>
      ["selected", "finalized", "withdrawn", "not_selected"].includes(application.status),
    )
    .map((application) => ({
      company: resultCompany?.name ?? "",
      bidding_method: resultCompany?.bidding_mode === "automatic" ? "Automatic" : "Committee",
      company_finalized_at: resultCompany?.finalized_at ?? "",
      registration_number: application.profile?.registration_number ?? "",
      student: application.profile?.full_name ?? "",
      email: application.profile?.email ?? "",
      outcome: ["selected", "finalized"].includes(application.status)
        ? "Selected"
        : formatStatus(application.status),
      initial_bid: application.initial_bid,
      accepted_bid: application.accepted_bid,
      points_deducted: application.final_points_deducted,
      withdrawal_charge: application.withdrawal_charge,
      withdrawn_at: application.withdrawn_at ?? "",
      application_finalized_at: application.finalized_at ?? "",
    }));
  const applicantRows = active.map((application) => ({
    registration_number: application.profile?.registration_number ?? "",
    student: application.profile?.full_name ?? "",
    email: application.profile?.email ?? "",
    company: application.company?.name ?? "",
    accepted_bid: application.accepted_bid,
    status: application.status,
  }));

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <span className="page-kicker">BIDDING CONTROL ROOM</span>
          <h1>Live session dashboard</h1>
          <p>Run committee-controlled rounds or monitor automatic ranked auctions company by company.</p>
        </div>
        <CsvExport filename="live-applicants" rows={applicantRows} label="Export applicants" />
      </div>

      <section className="metric-grid">
        <article className="metric-card emphasis"><span className="metric-icon"><Building2 /></span><div><small>LIVE COMPANY</small><strong className="metric-word">{live?.name ?? "None"}</strong><p>{live ? `Closes ${formatDateTime(live.closes_at)}` : "No active session"}</p></div></article>
        <article className="metric-card"><span className="metric-icon blue"><Users /></span><div><small>STUDENTS IN SESSION</small><strong>{live?.applicant_count ?? 0}</strong><p>{live?.cv_requirement ?? 0} available CV slots</p></div></article>
        <article className="metric-card"><span className="metric-icon amber"><Hourglass /></span><div><small>{live?.bidding_mode === "automatic" ? "INACTIVITY TIMER" : "PENDING RESPONSES"}</small><strong className={live?.bidding_mode === "automatic" ? "metric-word" : ""}>{live?.bidding_mode === "automatic" && live.auto_closes_at ? <Countdown deadline={live.auto_closes_at} /> : live?.pending_count ?? 0}</strong><p>{live?.bidding_mode === "automatic" ? `${live.inactivity_timeout_seconds}s after the latest bid` : "Waiting for Stay or Withdraw"}</p></div></article>
        <article className="metric-card"><span className="metric-icon purple"><CircleDollarSign /></span><div><small>{live?.bidding_mode === "automatic" ? "HIGHEST BID" : "CURRENT BID"}</small><strong>{live?.current_bid ?? 0}</strong><p>{live?.bidding_mode === "automatic" ? "Submitted by students" : "Controlled by administrators"}</p></div></article>
      </section>

      {resultCompany && (
        <section className="round-results" id="finalized-outcomes" aria-labelledby="finalized-outcomes-title">
          <header>
            <span className="round-results-icon"><Trophy /></span>
            <div>
              <span className="page-kicker">FINALIZED OUTCOME MONITOR</span>
              <h2 id="finalized-outcomes-title">Selected students for {resultCompany.name}</h2>
              <p>{selectedResults.length} of {resultCompany.cv_requirement} positions filled · {withdrawnResults.length} withdrawn · Finalized {formatDateTime(resultCompany.finalized_at)}</p>
            </div>
            <CsvExport
              filename={`${resultCompany.slug}-finalized-outcomes`}
              rows={outcomeRows}
              label="Download outcomes"
            />
          </header>
          <nav className="outcome-company-tabs" aria-label="Finalized companies">
            {finalizedCompanies.map((company) => (
              <Link
                key={company.id}
                href={`/admin?results=${company.id}#finalized-outcomes`}
                aria-current={company.id === resultCompany.id ? "page" : undefined}
              >
                <span>{company.name}</span>
                <small>{formatDateTime(company.finalized_at)}</small>
              </Link>
            ))}
          </nav>
          <div className="round-results-grid admin-outcome-grid">
            <article className="round-result-group selected">
              <div><strong>Selected students</strong><span>{selectedResults.length} selected</span></div>
              {selectedResults.length ? (
                <ul>
                  {selectedResults.map((application) => (
                    <li key={application.id}>
                      <span className="participant-avatar" aria-hidden="true">{initials(application.profile?.full_name ?? "Student")}</span>
                      <span><strong>{application.profile?.full_name ?? "Unknown student"}</strong><small>{application.profile?.registration_number ?? application.profile?.email} · {application.final_points_deducted || application.accepted_bid} pts</small></span>
                      <b>Selected</b>
                    </li>
                  ))}
                </ul>
              ) : <p>No student qualified for a position.</p>}
            </article>
            <article className="round-result-group outcomes">
              <div><strong>Withdrawn students</strong><span>{withdrawnResults.length} withdrawn</span></div>
              {withdrawnResults.length ? (
                <ul>
                  {withdrawnResults.map((application) => (
                    <li key={application.id}>
                      <span className="participant-avatar" aria-hidden="true">{initials(application.profile?.full_name ?? "Student")}</span>
                      <span><strong>{application.profile?.full_name ?? "Unknown student"}</strong><small>{application.profile?.registration_number ?? application.profile?.email} · {application.withdrawal_charge ? `${application.withdrawal_charge} pts charged` : "Reservation released"}</small></span>
                      <b>Withdrawn</b>
                    </li>
                  ))}
                </ul>
              ) : <p>No students withdrew from this company.</p>}
            </article>
            {notSelectedResults.length > 0 && (
              <article className="round-result-group outcomes">
                <div><strong>Not selected</strong><span>{notSelectedResults.length} students</span></div>
                <ul>
                  {notSelectedResults.map((application) => (
                    <li key={application.id}>
                      <span className="participant-avatar" aria-hidden="true">{initials(application.profile?.full_name ?? "Student")}</span>
                      <span><strong>{application.profile?.full_name ?? "Unknown student"}</strong><small>{application.profile?.registration_number ?? application.profile?.email} · {application.accepted_bid} pt bid · Reservation released</small></span>
                      <b>Not selected</b>
                    </li>
                  ))}
                </ul>
              </article>
            )}
          </div>
        </section>
      )}

      {live ? (
        <>
          {live.bidding_mode === "committee" && live.applicant_count > live.cv_requirement && (
            <div className="warning-banner"><AlertTriangle /><span><strong>Company is oversubscribed</strong>{live.applicant_count} students are staying for {live.cv_requirement} slots. An administrator can increase the bid.</span></div>
          )}
          {live.bidding_mode === "committee" && responseDeadline && (
            <div className="warning-banner response-window-banner">
              <Hourglass />
              <span className="response-window-copy">
                <strong>Manual bidding ends at zero</strong>
                {live.pending_count > 0
                  ? `${live.pending_count} students still need to choose Stay or Withdraw. `
                  : "All students have responded. "}
                The available positions will be selected and the company will be finalized automatically.
              </span>
              {profile.role === "admin"
                ? <ManualRoundTimer companyId={live.id} deadline={responseDeadline} />
                : <div className="response-window-timer"><small>BIDDING ENDS IN</small><strong><Countdown deadline={responseDeadline} /></strong><small>{formatDateTime(responseDeadline)}</small></div>}
            </div>
          )}
          <section className="admin-live-card">
            <div className="admin-live-head">
              <div className="admin-live-company"><CompanyAvatar name={live.name} logoUrl={live.logo_url} large /><div><span className="live-label"><span className="live-dot" /> {live.bidding_mode === "automatic" ? "AUTOMATIC AUCTION" : "COMMITTEE SESSION"}</span><h2>{live.name}</h2><p>{live.industry} · {live.location}</p></div></div>
              <StatusBadge status={live.status} />
            </div>
            <div className="admin-live-stats">
              <div><small>STUDENTS STAYING</small><strong>{live.applicant_count}</strong><span>{live.cv_requirement} CV slots</span></div>
              <div><small>DEMAND RATIO</small><strong className={live.demand_ratio > 1 ? "danger-text" : ""}>{live.demand_ratio.toFixed(2)}×</strong><span>{demandCategory(live.demand_ratio)}</span></div>
              <div><small>{live.bidding_mode === "automatic" ? "HIGHEST BID" : "CURRENT BID"}</small><strong>{live.current_bid}</strong><span>{live.bidding_mode === "automatic" ? "Top bids selected at close" : `+${live.bid_increment} default increment`}</span></div>
              <div><small>{live.bidding_mode === "automatic" ? "AUTO CLOSE" : "RESPONSES"}</small><strong>{live.bidding_mode === "automatic" && live.auto_closes_at ? <Countdown deadline={live.auto_closes_at} /> : live.confirmed_count}</strong><span>{live.bidding_mode === "automatic" ? `${live.inactivity_timeout_seconds}s inactivity window` : `${live.pending_count} still pending`}</span></div>
            </div>
            <div className="demand-track large"><span className={live.demand_ratio > 1 ? "over" : ""} style={{ width: `${Math.min(100, live.demand_ratio * 100)}%` }} /></div>
            {profile.role === "admin" && <AdminCompanyControls company={live} />}
          </section>
        </>
      ) : (
        <section className="no-live-banner admin"><Gavel /><div><strong>No bidding session is live</strong><span>Open an upcoming company from the company management page.</span></div><a href="/admin/companies">Manage companies <ArrowRight size={16} /></a></section>
      )}

      <section className="dashboard-section">
        <div className="section-title-row"><div><span className="page-kicker">LIVE APPLICANT FEED</span><h2>Student responses</h2></div><span className="realtime-state connected"><span className="live-dot" /> Updates automatically</span></div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Student</th><th>Company</th><th>Reserved bid</th><th>Applied</th><th>Response</th></tr></thead>
            <tbody>{active.slice(0, 12).map((application) => <tr key={application.id}><td><div className="table-person"><span className="table-user-icon"><UserRoundCheck /></span><span><strong>{application.profile?.full_name}</strong><small>{application.profile?.registration_number}</small></span></div></td><td>{application.company?.name}</td><td><strong>{application.reserved_points} pts</strong></td><td>{formatDateTime(application.applied_at)}</td><td><StatusBadge status={application.status} /></td></tr>)}</tbody>
          </table>
          {!active.length && <div className="empty-list">No active applicants yet.</div>}
        </div>
      </section>
    </div>
  );
}
