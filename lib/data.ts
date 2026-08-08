import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizePublicCompanyAnalytics } from "@/lib/public-analytics";
import type {
  Application,
  AuditLog,
  BidParticipant,
  Company,
  ManualBidHistory,
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
    withdrawal_penalty_percent: Number(row.withdrawal_penalty_percent ?? 10),
    response_duration_minutes: Number(row.response_duration_minutes ?? 10),
    bidding_mode: row.bidding_mode === "automatic" ? "automatic" : "committee",
    inactivity_timeout_seconds: Number(row.inactivity_timeout_seconds ?? 120),
    last_bid_at: (row.last_bid_at as string | null | undefined) ?? null,
    auto_closes_at: (row.auto_closes_at as string | null | undefined) ?? null,
    demand_ratio: cvRequirement > 0 ? applicantCount / cvRequirement : 0,
  };
}

function attachLatestManualBids(
  rows: Record<string, unknown>[],
  historyRows: ManualBidHistory[],
) {
  const latestByCompany = new Map<string, ManualBidHistory>();
  for (const history of historyRows) {
    if (!latestByCompany.has(history.company_id)) {
      latestByCompany.set(history.company_id, history);
    }
  }

  return rows.map((row) => ({
    ...normalizeCompany(row),
    last_manual_bid: latestByCompany.get(String(row.id)) ?? null,
  }));
}

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function loadStudentCompanyData(
  supabase: ServerSupabaseClient,
  studentId: string,
) {
  const [companiesResult, applicationsResult] = await Promise.all([
    supabase.from("companies").select("*").order("status").order("opens_at"),
    supabase
      .from("applications")
      .select("*, company:companies(id,name,slug,logo_url,industry)")
      .eq("student_id", studentId)
      .order("applied_at", { ascending: false }),
  ]);

  if (companiesResult.error) throw new Error(companiesResult.error.message);
  if (applicationsResult.error) throw new Error(applicationsResult.error.message);

  const applications = (applicationsResult.data ?? []) as unknown as Application[];
  const applicationByCompany = new Map(applications.map((application) => [application.company_id, application]));
  const normalizedCompanies = (companiesResult.data ?? []).map((row) => ({
    ...normalizeCompany(row),
    application: applicationByCompany.get(String(row.id)) ?? null,
  }));
  const liveCompany = normalizedCompanies.find((company) =>
    ["open", "paused", "bid_increase_pending"].includes(company.status),
  );
  let participants: BidParticipant[] = [];
  if (liveCompany) {
    const { data, error } = await supabase.rpc("get_bid_participants", {
      p_company_id: liveCompany.id,
    });
    if (error) throw new Error(error.message);
    participants = (data ?? []) as BidParticipant[];
  }
  const companies = normalizedCompanies.map((company) => ({
    ...company,
    ...(company.id === liveCompany?.id ? { participants } : {}),
  }));

  return { companies, applications };
}

export async function getStudentOverviewData(studentId: string) {
  const supabase = await createClient();
  const [companyData, notificationsResult] = await Promise.all([
    loadStudentCompanyData(supabase, studentId),
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", studentId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (notificationsResult.error) throw new Error(notificationsResult.error.message);

  return {
    ...companyData,
    notifications: (notificationsResult.data ?? []) as Notification[],
  };
}

export async function getStudentActivityData(studentId: string) {
  const supabase = await createClient();
  const [applicationsResult, transactionsResult] = await Promise.all([
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
  ]);

  if (applicationsResult.error) throw new Error(applicationsResult.error.message);
  if (transactionsResult.error) throw new Error(transactionsResult.error.message);

  return {
    applications: (applicationsResult.data ?? []) as unknown as Application[],
    transactions: (transactionsResult.data ?? []) as unknown as PointTransaction[],
  };
}

export async function getStudentCompaniesData(studentId: string) {
  const supabase = await createClient();
  return loadStudentCompanyData(supabase, studentId);
}

export async function getCompanyBySlug(slug: string, studentId: string) {
  const supabase = await createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("slug", slug)
    .single();
  if (!company) return null;

  const [applicationResult, participantResult] = await Promise.all([
    supabase
      .from("applications")
      .select("*")
      .eq("company_id", company.id)
      .eq("student_id", studentId)
      .maybeSingle(),
    supabase.rpc("get_bid_participants", { p_company_id: company.id }),
  ]);

  if (participantResult.error) throw new Error(participantResult.error.message);

  return {
    ...normalizeCompany(company),
    application: (applicationResult.data as Application | null) ?? null,
    participants: (participantResult.data ?? []) as BidParticipant[],
  };
}

export async function getAdminOverviewData() {
  const supabase = await createClient();
  const [companiesResult, applicationsResult, bidHistoryResult] = await Promise.all([
    supabase.from("companies").select("*").order("updated_at", { ascending: false }),
    supabase
      .from("applications")
      .select(
        "*, company:companies(id,name,slug,logo_url,industry), profile:profiles(id,full_name,registration_number,email)",
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("bid_history")
      .select("id,company_id,previous_bid,new_bid,created_at")
      .is("reverted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (companiesResult.error) throw new Error(companiesResult.error.message);
  if (applicationsResult.error) throw new Error(applicationsResult.error.message);
  if (bidHistoryResult.error) throw new Error(bidHistoryResult.error.message);

  return {
    companies: attachLatestManualBids(
      companiesResult.data ?? [],
      (bidHistoryResult.data ?? []) as ManualBidHistory[],
    ),
    applications: (applicationsResult.data ?? []) as unknown as Application[],
  };
}

export async function getAdminCompanies() {
  const supabase = await createClient();
  const [companiesResult, bidHistoryResult] = await Promise.all([
    supabase
      .from("companies")
      .select("*")
      .order("updated_at", { ascending: false }),
    supabase
      .from("bid_history")
      .select("id,company_id,previous_bid,new_bid,created_at")
      .is("reverted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (companiesResult.error) throw new Error(companiesResult.error.message);
  if (bidHistoryResult.error) throw new Error(bidHistoryResult.error.message);
  return attachLatestManualBids(
    companiesResult.data ?? [],
    (bidHistoryResult.data ?? []) as ManualBidHistory[],
  );
}

export async function getAdminStudents() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "student")
    .order("full_name");

  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function getAdminAuditLogs() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*, actor:profiles!audit_logs_actor_id_fkey(full_name,email)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AuditLog[];
}

export async function getCompanyForAdminEdit(companyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select(
      "id,name,slug,description,industry,location,available_roles,required_skills,cv_requirement,minimum_bid,current_bid,bid_increment,maximum_bid,withdrawal_penalty_percent,response_duration_minutes,bidding_mode,inactivity_timeout_seconds,last_bid_at,auto_closes_at,opens_at,closes_at,status,applicant_count,confirmed_count,pending_count,withdrawal_count",
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
