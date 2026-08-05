import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BriefcaseBusiness, CalendarClock, ExternalLink, MapPin, Users } from "lucide-react";
import { CompanyAvatar } from "@/components/company-avatar";
import { CompanyCard } from "@/components/company-card";
import { StatusBadge } from "@/components/status-badge";
import { availablePoints, demandCategory, formatDateTime } from "@/lib/business";
import { requireProfile } from "@/lib/auth";
import { getCompanyBySlug } from "@/lib/data";

export default async function CompanyDetailsPage({ params }: PageProps<"/student/companies/[slug]">) {
  const profile = await requireProfile(["student"]);
  const { slug } = await params;
  const company = await getCompanyBySlug(slug, profile.id);
  if (!company) notFound();

  return (
    <div className="dashboard-page company-detail-page">
      <Link className="back-link" href="/student/companies"><ArrowLeft size={16} /> Back to companies</Link>
      <header className="company-detail-hero"><CompanyAvatar name={company.name} logoUrl={company.logo_url} large /><div><div className="company-detail-title"><h1>{company.name}</h1><StatusBadge status={company.status} /></div><p>{company.industry} · {company.location}</p></div>{company.website_url && <a className="button button-ghost button-small" href={company.website_url} target="_blank" rel="noreferrer">Company website <ExternalLink size={15} /></a>}</header>
      <div className="company-detail-layout">
        <div className="company-detail-main">
          <section className="dashboard-section prose-card"><span className="page-kicker">ABOUT THE INTERNSHIP</span><h2>Build your career with {company.name}.</h2><p>{company.description || "Further company information will be shared by the internship committee."}</p><div className="detail-facts"><div><MapPin /><span><small>LOCATION</small><strong>{company.location}</strong></span></div><div><BriefcaseBusiness /><span><small>DURATION</small><strong>{company.internship_duration ?? "To be confirmed"}</strong></span></div><div><Users /><span><small>CV SLOTS</small><strong>{company.cv_requirement} students</strong></span></div><div><CalendarClock /><span><small>BIDDING WINDOW</small><strong>{formatDateTime(company.opens_at)} — {formatDateTime(company.closes_at)}</strong></span></div></div></section>
          <section className="dashboard-section"><div className="detail-columns"><div><span className="page-kicker">AVAILABLE ROLES</span><div className="large-tags">{company.available_roles.map((role) => <span key={role}>{role}</span>)}</div></div><div><span className="page-kicker">VALUED SKILLS</span><div className="large-tags muted">{company.required_skills.map((skill) => <span key={skill}>{skill}</span>)}</div></div></div></section>
          <section className="dashboard-section demand-explainer"><span className="page-kicker">LIVE DEMAND</span><h2>{demandCategory(company.demand_ratio)}</h2><div className="demand-track large"><span className={company.demand_ratio > 1 ? "over" : ""} style={{ width: `${Math.min(100, company.demand_ratio * 100)}%` }} /></div><p>{company.bidding_mode === "automatic" ? `${company.applicant_count} students are ranked by their own bids for ${company.cv_requirement} CV slots. The top bids at closing are selected, with earlier bids winning ties.` : `${company.applicant_count} students are currently staying in the session for ${company.cv_requirement} CV slots. The committee controls increases and each participating student can stay or withdraw.`} Names and current bidding states are shown in the session card.</p></section>
        </div>
        <aside className="company-detail-aside"><CompanyCard company={company} availablePoints={availablePoints(profile)} featured /></aside>
      </div>
    </div>
  );
}
