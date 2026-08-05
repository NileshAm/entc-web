import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizePublicCompanyAnalytics } from "@/lib/public-analytics";
import type {
  Application,
  AuditLog,
  Company,
  Notification,
  PointTransaction,
  Profile,
  PublicCompanyAnalytics,
} from "@/lib/types";

function normalizeCompany(row: Record<string, unknown>): Company {
  const cvRequirement = Number(row.cv_requirement ?? 1);
  const applicantCount = Number(row.applicant_count ?? 0);
  return {
    ...(row as unknown as Company),
    applicant_count: applicantCount,
    confirmed_count: Number(row.confirmed_count ?? 0),
    pending_count: Number(row.pending_count ?? 0),
    withdrawal_count: Number(row.withdrawal_count ?? 0),
    demand_ratio: cvRequirement > 0 ? applicantCount / cvRequirement : 0,
  };
}

export async function getStudentData(studentId: string) {
  const supabase = await createClient();
  const [profileResult, companiesResult, applicationsResult, transactionsResult, notificationsResult] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", studentId).single(),
      supabase.from("companies").select("*").order("status").order("opens_at"),
      supabase
        .from("applications")
        .select("*, company:companies(id,name,slug,logo_url,industry)")
        .eq("student_id", studentId)
        .order("applied_at", { ascending: false }),
      supabase
        .from("point_transactions")
        .select("*, company:companies(name)")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", studentId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const applications = (applicationsResult.data ?? []) as unknown as Application[];
  const applicationByCompany = new Map(applications.map((application) => [application.company_id, application]));
  const companies = (companiesResult.data ?? []).map((row) => ({
    ...normalizeCompany(row),
    application: applicationByCompany.get(String(row.id)) ?? null,
  }));

  return {
    profile: profileResult.data as Profile,
    companies,
    applications,
    transactions: (transactionsResult.data ?? []) as unknown as PointTransaction[],
    notifications: (notificationsResult.data ?? []) as Notification[],
  };
}

export async function getCompanyBySlug(slug: string, studentId: string) {
  const supabase = await createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("slug", slug)
    .single();
  if (!company) return null;

  const { data: application } = await supabase
    .from("applications")
    .select("*")
    .eq("company_id", company.id)
    .eq("student_id", studentId)
    .maybeSingle();

  return {
    ...normalizeCompany(company),
    application: (application as Application | null) ?? null,
  };
}

export async function getAdminData() {
  const supabase = await createClient();
  const [companiesResult, applicationsResult, studentsResult, transactionsResult, auditResult] =
    await Promise.all([
      supabase.from("companies").select("*").order("updated_at", { ascending: false }),
      supabase
        .from("applications")
        .select(
          "*, company:companies(id,name,slug,logo_url,industry), profile:profiles(id,full_name,registration_number,email)",
        )
        .order("updated_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("*")
        .eq("role", "student")
        .order("full_name"),
      supabase.from("point_transactions").select("*").order("created_at", { ascending: false }),
      supabase
        .from("audit_logs")
        .select("*, actor:profiles!audit_logs_actor_id_fkey(full_name,email)")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  return {
    companies: (companiesResult.data ?? []).map(normalizeCompany),
    applications: (applicationsResult.data ?? []) as unknown as Application[],
    students: (studentsResult.data ?? []) as Profile[],
    transactions: (transactionsResult.data ?? []) as PointTransaction[],
    auditLogs: (auditResult.data ?? []) as unknown as AuditLog[],
  };
}

export async function getCompanyForAdminEdit(companyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select(
      "id,name,slug,description,industry,location,available_roles,required_skills,cv_requirement,minimum_bid,current_bid,bid_increment,maximum_bid,opens_at,closes_at,status,applicant_count,confirmed_count,pending_count,withdrawal_count",
    )
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? normalizeCompany(data) : null;
}

export async function getPublicBidAnalytics(): Promise<PublicCompanyAnalytics[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_bid_analytics");
  if (error) throw new Error(error.message);

  return (data ?? []).map(normalizePublicCompanyAnalytics);
}
