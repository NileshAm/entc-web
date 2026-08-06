import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BriefcaseBusiness, CalendarClock, ExternalLink, MapPin, Trophy, Users } from "lucide-react";
import { CompanyAvatar } from "@/components/company-avatar";
import { CompanyCard } from "@/components/company-card";
import { StatusBadge } from "@/components/status-badge";
import { availablePoints, demandCategory, formatDateTime, participantRankingLabel } from "@/lib/business";
import { requireProfile } from "@/lib/auth";
import { getCompanyBySlug } from "@/lib/data";

export default async function CompanyDetailsPage({
  params,
  searchParams,
}: PageProps<"/student/companies/[slug]">) {
  const profile = await requireProfile(["student"]);
  const { slug } = await params;
  const query = await searchParams;
  const showRoundResults = query.roundResults === "1";
  const timerExpired = query.timerExpired === "1";
  const company = await getCompanyBySlug(slug, profile.id);
  if (!company) notFound();

  const inactiveStates = ["withdrawn", "not_selected"];
  const selectedParticipants = company.participants.filter((participant) =>
    participant.is_currently_selected && !inactiveStates.includes(participant.response_state)
  );
  const otherParticipants = company.participants.filter((participant) =>
    !selectedParticipants.includes(participant)
  );
  const selfParticipant = company.participants.find((participant) => participant.is_self);
  const selfWasWithdrawn = selfParticipant?.response_state === "withdrawn";

  return (
    <div className="dashboard-page company-detail-page">
      <Link className="back-link" href="/student/companies"><ArrowLeft size={16} /> Back to companies</Link>
      <header className="company-detail-hero"><CompanyAvatar name={company.name} logoUrl={company.logo_url} large /><div><div className="company-detail-title"><h1>{company.name}</h1><StatusBadge status={company.status} /></div><p>{company.industry} · {company.location}</p></div>{company.website_url && <a className="button button-ghost button-small" href={company.website_url} target="_blank" rel="noreferrer">Company website <ExternalLink size={15} /></a>}</header>
      {showRoundResults && (
        <section className="round-results" aria-labelledby="round-results-title">
          <header>
            <span className="round-results-icon"><Trophy /></span>
            <div>
              <span className="page-kicker">MANUAL ROUND RESULTS</span>
              <h2 id="round-results-title">{company.status === "finalized" ? "Final selected students" : "Currently selected students"}</h2>
              <p>{timerExpired && selfWasWithdrawn
                ? "Your response timer expired and your withdrawal was settled. The current selection is shown below."
                : "The response timer has ended. Here is the current selection after the completed round."}</p>
            </div>
          </header>
          <div className="round-results-grid">
            <div className="round-result-group selected">
              <div><strong>Selected for {company.cv_requirement} {company.cv_requirement === 1 ? "position" : "positions"}</strong><span>{selectedParticipants.length} currently selected</span></div>
              {selectedParticipants.length ? (
                <ul>
                  {selectedParticipants.map((participant, index) => (
                    <li key={`${participant.full_name}-${index}`}><span className="participant-avatar">{participant.full_name.charAt(0).toUpperCase()}</span><span><strong>{participant.full_name}{participant.is_self ? " (You)" : ""}</strong><small>{participantRankingLabel(participant, company.bidding_mode, company.cv_requirement)}</small></span><b>Selected</b></li>
                  ))}
                </ul>
              ) : <p>No student is currently inside the available positions.</p>}
            </div>
            <div className="round-result-group outcomes">
              <div><strong>Other outcomes</strong><span>Withdrawn and outside the selection</span></div>
              {otherParticipants.length ? (
                <ul>
                  {otherParticipants.map((participant, index) => (
                    <li key={`${participant.full_name}-${index}`}><span className="participant-avatar">{participant.full_name.charAt(0).toUpperCase()}</span><span><strong>{participant.full_name}{participant.is_self ? " (You)" : ""}</strong><small>{participantRankingLabel(participant, company.bidding_mode, company.cv_requirement)}</small></span><b>{participant.response_state === "withdrawn" ? "Withdrawn" : "Not selected"}</b></li>
                  ))}
                </ul>
              ) : <p>No other outcomes in this round.</p>}
            </div>
          </div>
          {company.status !== "finalized" && <p className="round-results-note">This is the current selection after the response deadline. It becomes final when the committee finalizes the company.</p>}
        </section>
      )}
      <div className="company-detail-layout">
        <div className="company-detail-main">
          <section className="dashboard-section prose-card"><span className="page-kicker">ABOUT THE INTERNSHIP</span><h2>Build your career with {company.name}.</h2><p>{company.description || "Further company information will be shared by the internship committee."}</p><div className="detail-facts"><div><MapPin /><span><small>LOCATION</small><strong>{company.location}</strong></span></div><div><BriefcaseBusiness /><span><small>DURATION</small><strong>{company.internship_duration ?? "To be confirmed"}</strong></span></div><div><Users /><span><small>CV SLOTS</small><strong>{company.cv_requirement} students</strong></span></div><div><CalendarClock /><span><small>BIDDING WINDOW</small><strong>{formatDateTime(company.opens_at)} — {formatDateTime(company.closes_at)}</strong></span></div></div></section>
          <section className="dashboard-section"><div className="detail-columns"><div><span className="page-kicker">AVAILABLE ROLES</span><div className="large-tags">{company.available_roles.map((role) => <span key={role}>{role}</span>)}</div></div><div><span className="page-kicker">VALUED SKILLS</span><div className="large-tags muted">{company.required_skills.map((skill) => <span key={skill}>{skill}</span>)}</div></div></div></section>
          <section className="dashboard-section demand-explainer"><span className="page-kicker">LIVE DEMAND</span><h2>{demandCategory(company.demand_ratio)}</h2><div className="demand-track large"><span className={company.demand_ratio > 1 ? "over" : ""} style={{ width: `${Math.min(100, company.demand_ratio * 100)}%` }} /></div><p>{company.bidding_mode === "automatic" ? `${company.applicant_count} students are ranked by their own bids for ${company.cv_requirement} CV slots. The top bids at closing are selected, with earlier bids winning ties.` : `${company.applicant_count} students are currently staying in the session for ${company.cv_requirement} CV slots. The committee controls increases and each participating student can stay or withdraw.`} Names and current bidding states are shown in the session card.</p></section>
        </div>
        <aside className="company-detail-aside"><CompanyCard company={company} availablePoints={availablePoints(profile)} featured showRoundResults={showRoundResults} /></aside>
      </div>
    </div>
  );
}
