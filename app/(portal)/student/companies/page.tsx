import type { Metadata } from "next";
import { CompanyList } from "@/components/company-list";
import { availablePoints } from "@/lib/business";
import { requireProfile } from "@/lib/auth";
import { getStudentCompaniesData } from "@/lib/data";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const profile = await requireProfile(["student"]);
  const { companies } = await getStudentCompaniesData(profile.id);
  return (
    <div className="dashboard-page">
      <div className="page-title-row"><div><span className="page-kicker">COMPANY CATALOGUE</span><h1>Find your next opportunity.</h1><p>Search the batch catalogue and follow live demand before you apply.</p></div><div className="balance-pill"><span>Available to bid</span><strong>{availablePoints(profile)} points</strong></div></div>
      <CompanyList companies={companies} availablePoints={availablePoints(profile)} />
    </div>
  );
}
