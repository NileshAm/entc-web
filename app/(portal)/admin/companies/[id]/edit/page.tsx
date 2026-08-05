import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { CompanyForm } from "@/components/company-form";
import { requireProfile } from "@/lib/auth";
import { getCompanyForAdminEdit } from "@/lib/data";

export const metadata: Metadata = { title: "Edit company" };

export default async function EditCompanyPage({ params }: PageProps<"/admin/companies/[id]/edit">) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const company = await getCompanyForAdminEdit(id);
  if (!company) notFound();

  return (
    <div className="dashboard-page">
      <Link className="back-link" href="/admin/companies"><ArrowLeft size={16} /> Back to companies</Link>
      <div className="page-title-row">
        <div>
          <span className="page-kicker">COMPANY SETTINGS</span>
          <h1>Edit {company.name}</h1>
          <p>Update the catalogue entry, bid rules, and schedule.</p>
        </div>
      </div>
      <section className="dashboard-section">
        <CompanyForm company={company} />
      </section>
    </div>
  );
}
