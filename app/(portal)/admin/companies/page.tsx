import type { Metadata } from "next";
import { AdminCompanyControls } from "@/components/admin-company-controls";
import { CompanyAvatar } from "@/components/company-avatar";
import { CompanyCsvImport } from "@/components/company-csv-import";
import { CompanyForm } from "@/components/company-form";
import { StatusBadge } from "@/components/status-badge";
import { requireProfile } from "@/lib/auth";
import { getAdminCompanies } from "@/lib/data";

export const metadata: Metadata = { title: "Manage companies" };

export default async function AdminCompaniesPage() {
  const profile = await requireProfile(["admin", "viewer"]);
  const companies = await getAdminCompanies();
  return <div className="dashboard-page"><div className="page-title-row"><div><span className="page-kicker">CATALOGUE & SCHEDULE</span><h1>Company management</h1><p>Choose committee-controlled or automatic ranked bidding for each upcoming company, then configure its rules and schedule.</p></div></div>{profile.role === "admin" && <CompanyCsvImport />}<section className="dashboard-section"><div className="section-title-row"><div><span className="page-kicker">ALL COMPANIES</span><h2>{companies.length} companies</h2></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Company</th><th>Method</th><th>CV slots</th><th>Current / maximum</th><th>Applicants</th><th>Status</th>{profile.role === "admin" && <th />}</tr></thead><tbody>{companies.map((company) => <tr key={company.id}><td><div className="table-company"><CompanyAvatar name={company.name} logoUrl={company.logo_url} /><span><strong>{company.name}</strong><small>{company.industry} · {company.location}</small></span></div></td><td><strong>{company.bidding_mode === "automatic" ? "Automatic" : "Committee"}</strong></td><td>{company.cv_requirement}</td><td>{company.current_bid} / {company.maximum_bid ?? "—"} pts</td><td>{company.applicant_count}</td><td><StatusBadge status={company.status} /></td>{profile.role === "admin" && <td><AdminCompanyControls company={company} compact /></td>}</tr>)}</tbody></table></div></section>{profile.role === "admin" && <section className="dashboard-section"><div className="section-title-row"><div><span className="page-kicker">NEW OPPORTUNITY</span><h2>Add one company manually</h2></div></div><CompanyForm /></section>}</div>;
}
