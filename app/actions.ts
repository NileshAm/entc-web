"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import {
  companyInputValues,
  companySchema,
  companyUpdateSchema,
} from "@/lib/company-validation";
import { parseCompanyCsv } from "@/lib/company-csv";
import { studentRegistrationSchema } from "@/lib/registration";
import { parseStudentIpCsv } from "@/lib/student-ip-csv";
import { createClient } from "@/lib/supabase/server";
import type { ActionState, CompanyStatus } from "@/lib/types";

function resultFromError(error: unknown): ActionState {
  if (error instanceof Error) return { ok: false, message: error.message };
  return { ok: false, message: "Something went wrong. Please try again." };
}

export async function registerStudent(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const parsed = studentRegistrationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Check your account details.",
      };
    }

    const value = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email: value.email,
      password: value.password,
      options: {
        data: {
          full_name: value.fullName,
          registration_number: value.registrationNumber.toUpperCase(),
        },
      },
    });

    if (error) {
      if (error.message.toLowerCase().includes("database error saving new user")) {
        return {
          ok: false,
          message: "That email or student index is already registered.",
        };
      }
      throw new Error(error.message);
    }

    // InternBid has no email-verification flow. A successful registration must
    // create a usable session immediately; never send students into an email
    // confirmation dead end when a hosted Auth project is misconfigured.
    if (!data.session) {
      return {
        ok: false,
        message: "Account creation is temporarily unavailable. Please contact an administrator.",
      };
    }

    return {
      ok: true,
      message: "Your student account is ready.",
    };
  } catch (error) {
    return resultFromError(error);
  }
}

async function rpcAction(
  role: "student" | "admin",
  rpc: string,
  args: Record<string, unknown>,
  successMessage: string,
): Promise<ActionState> {
  try {
    await requireProfile([role]);
    const supabase = await createClient();
    const { error } = await supabase.rpc(rpc, args);
    if (error) throw new Error(error.message);
    revalidatePath("/student", "layout");
    revalidatePath("/admin", "layout");
    revalidatePath("/analytics");
    return { ok: true, message: successMessage };
  } catch (error) {
    return resultFromError(error);
  }
}

export async function applyToCompany(companyId: string) {
  return rpcAction(
    "student",
    "apply_to_company",
    { p_company_id: companyId },
    "Application submitted. The current bid is now reserved.",
  );
}

export async function submitAutomaticBid(companyId: string, bid: number) {
  if (!Number.isInteger(bid) || bid < 0) {
    return { ok: false, message: "Enter a valid whole-number bid." };
  }
  return rpcAction(
    "student",
    "submit_automatic_bid",
    { p_company_id: companyId, p_bid: bid },
    "Bid submitted. The inactivity timer has restarted.",
  );
}

export async function withdrawApplication(applicationId: string) {
  return rpcAction(
    "student",
    "withdraw_application",
    { p_application_id: applicationId },
    "Application withdrawn. The applicable base-bid and increase withdrawal charge was applied.",
  );
}

export async function respondToBid(applicationId: string, stay: boolean) {
  return rpcAction(
    "student",
    "respond_to_bid_increase",
    { p_application_id: applicationId, p_accept: stay },
    stay
      ? "You are staying in the session at the new bid."
      : "You withdrew from the session and the withdrawal charge was applied.",
  );
}

export async function forceWithdrawExpiredResponse(applicationId: string) {
  try {
    await requireProfile(["student"]);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("force_withdraw_expired_bid_response", {
      p_application_id: applicationId,
    });
    if (error) throw new Error(error.message);
    if (!data) {
      return { ok: false, message: "This bid response is no longer awaiting timeout processing." };
    }
    revalidatePath("/student", "layout");
    revalidatePath("/analytics");
    return {
      ok: true,
      message: "The response deadline expired. You were force-withdrawn and the withdrawal charge was deducted.",
    };
  } catch (error) {
    return resultFromError(error);
  }
}

export async function changeCompanyStatus(companyId: string, status: CompanyStatus) {
  return rpcAction(
    "admin",
    "change_company_status",
    { p_company_id: companyId, p_status: status, p_reason: null },
    `Company status changed to ${status.replaceAll("_", " ")}.`,
  );
}

export async function increaseCompanyBid(
  companyId: string,
  customBid?: number,
  reason?: string,
) {
  if (customBid !== undefined && (!Number.isInteger(customBid) || customBid <= 0)) {
    return { ok: false, message: "Enter a valid whole-number bid." };
  }

  return rpcAction(
    "admin",
    "increase_company_bid",
    {
      p_company_id: companyId,
      p_custom_bid: customBid ?? null,
      p_reason: reason?.trim() || null,
    },
    "Bid increased. Students must now choose Stay or Withdraw.",
  );
}

export async function finalizeCompany(companyId: string) {
  return rpcAction(
    "admin",
    "finalize_company",
    { p_company_id: companyId },
    "Bidding finalized and points deducted in one transaction.",
  );
}

export async function finalizeAutomaticBidding(companyId: string) {
  return rpcAction(
    "admin",
    "finalize_automatic_bidding",
    { p_company_id: companyId },
    "Automatic bidding closed and the top bids were selected.",
  );
}

export async function finishExpiredCommitteeBidding(companyId: string) {
  return rpcAction(
    "admin",
    "finish_expired_committee_bidding",
    { p_company_id: companyId },
    "Manual bidding ended and the selected students were finalized.",
  );
}

export async function adjustStudentPoints(
  studentId: string,
  amount: number,
  reason: string,
) {
  return rpcAction(
    "admin",
    "adjust_student_points",
    { p_student_id: studentId, p_amount: amount, p_reason: reason },
    "Student point balance updated.",
  );
}

export async function setStudentIpPoints(
  studentId: string,
  total: number,
  reason: string,
) {
  if (!Number.isInteger(total) || total < 0 || total > 2_147_483_647) {
    return { ok: false, message: "Enter a non-negative whole-number IP total." };
  }

  return rpcAction(
    "admin",
    "set_student_ip_points",
    { p_student_id: studentId, p_total: total, p_reason: reason },
    "Student IP point total updated.",
  );
}

interface StudentIpImportSummary {
  csv_rows: number;
  matched: number;
  defaulted: number;
  ignored: number;
  updated: number;
}

export async function importStudentIpPoints(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireProfile(["admin"]);

    const upload = formData.get("file");
    if (!upload || typeof upload === "string" || upload.size === 0) {
      return { ok: false, message: "Choose a CSV file to import." };
    }
    if (!upload.name.toLowerCase().endsWith(".csv")) {
      return { ok: false, message: "The selected file must use the .csv extension." };
    }
    if (upload.size > 500 * 1024) {
      return { ok: false, message: "The CSV file must be 500 KB or smaller." };
    }

    const rows = parseStudentIpCsv(await upload.text());
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("import_student_ip_points", {
      p_rows: rows,
      p_default_total: 80,
    });
    if (error) throw new Error(error.message);

    const summary = data as StudentIpImportSummary;
    revalidatePath("/student", "layout");
    revalidatePath("/admin", "layout");

    return {
      ok: true,
      message: `Import complete: ${summary.updated} student${summary.updated === 1 ? "" : "s"} changed, ${summary.matched} matched by index, ${summary.defaulted} set to the 80-point default, and ${summary.ignored} unknown CSV row${summary.ignored === 1 ? " was" : "s were"} ignored.`,
    };
  } catch (error) {
    return resultFromError(error);
  }
}

export async function createCompany(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requireProfile(["admin"]);
    const parsed = companySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the company details." };
    }
    const value = parsed.data;
    if (value.maximumBid !== "" && value.maximumBid < value.minimumBid) {
      return { ok: false, message: "Maximum bid must be at least the minimum bid." };
    }
    const companyValues = companyInputValues(value);
    if (companyValues.closes_at && companyValues.opens_at && companyValues.closes_at <= companyValues.opens_at) {
      return { ok: false, message: "Closing time must be after opening time." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("companies")
      .insert({
        ...companyValues,
        current_bid: value.minimumBid,
        created_by: admin.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("audit_logs").insert({
      actor_id: admin.id,
      actor_role: admin.role,
      action: "company.created",
      entity_type: "company",
      entity_id: data.id,
      new_value: {
        name: value.name,
        minimum_bid: value.minimumBid,
        bid_increment: value.bidIncrement,
        withdrawal_penalty_percent: value.withdrawalPenaltyPercent,
        response_duration_minutes: value.responseDurationMinutes,
        bidding_mode: value.biddingMode,
        inactivity_timeout_seconds: value.inactivityTimeoutSeconds,
      },
    });
    revalidatePath("/admin", "layout");
    return { ok: true, message: `${value.name} was added as an upcoming company.` };
  } catch (error) {
    return resultFromError(error);
  }
}

export async function importCompanies(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireProfile(["admin"]);

    const upload = formData.get("file");
    if (!upload || typeof upload === "string" || upload.size === 0) {
      return { ok: false, message: "Choose a company CSV file to import." };
    }
    if (!upload.name.toLowerCase().endsWith(".csv")) {
      return { ok: false, message: "The selected file must use the .csv extension." };
    }
    if (upload.size > 500 * 1024) {
      return { ok: false, message: "The CSV file must be 500 KB or smaller." };
    }

    const companies = parseCompanyCsv(await upload.text());
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("import_companies", {
      p_companies: companies,
    });
    if (error?.code === "23505") {
      return { ok: false, message: "A company URL slug in the CSV is already in use." };
    }
    if (error) throw new Error(error.message);

    const summary = data as { created: number };
    revalidatePath("/admin", "layout");
    revalidatePath("/student", "layout");
    revalidatePath("/analytics");
    return {
      ok: true,
      message: `${summary.created} compan${summary.created === 1 ? "y was" : "ies were"} added as upcoming.`,
    };
  } catch (error) {
    return resultFromError(error);
  }
}

export async function updateCompany(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requireProfile(["admin"]);
    const parsed = companyUpdateSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Check the company details.",
      };
    }

    const value = parsed.data;
    if (value.maximumBid !== "" && value.maximumBid < value.minimumBid) {
      return { ok: false, message: "Maximum bid must be at least the minimum bid." };
    }
    const companyValues = companyInputValues(value);
    if (companyValues.closes_at && companyValues.opens_at && companyValues.closes_at <= companyValues.opens_at) {
      return { ok: false, message: "Closing time must be after opening time." };
    }

    const supabase = await createClient();
    const { data: existing, error: readError } = await supabase
      .from("companies")
      .select("id,name,slug,status,current_bid,minimum_bid,cv_requirement,bid_increment,maximum_bid,withdrawal_penalty_percent,response_duration_minutes,bidding_mode,inactivity_timeout_seconds")
      .eq("id", value.companyId)
      .single();
    if (readError || !existing) throw new Error(readError?.message ?? "Company not found.");

    const nextCurrentBid = existing.status === "upcoming"
      ? value.minimumBid
      : Number(existing.current_bid);
    if (existing.status !== "upcoming" && value.minimumBid > nextCurrentBid) {
      return { ok: false, message: "Minimum bid cannot exceed the current live bid." };
    }
    if (companyValues.maximum_bid !== null && companyValues.maximum_bid < nextCurrentBid) {
      return { ok: false, message: "Maximum bid cannot be below the current bid." };
    }

    const { error: updateError } = await supabase
      .from("companies")
      .update({
        ...companyValues,
        ...(existing.status === "upcoming" ? { current_bid: nextCurrentBid } : {}),
      })
      .eq("id", value.companyId);
    if (updateError) {
      if (updateError.code === "23505") {
        return { ok: false, message: "That company name or URL slug is already in use." };
      }
      throw new Error(updateError.message);
    }

    await supabase.from("audit_logs").insert({
      actor_id: admin.id,
      actor_role: admin.role,
      action: "company.updated",
      entity_type: "company",
      entity_id: value.companyId,
      previous_value: {
        name: existing.name,
        slug: existing.slug,
        minimum_bid: existing.minimum_bid,
        current_bid: existing.current_bid,
        cv_requirement: existing.cv_requirement,
        bid_increment: existing.bid_increment,
        maximum_bid: existing.maximum_bid,
        withdrawal_penalty_percent: existing.withdrawal_penalty_percent,
        response_duration_minutes: existing.response_duration_minutes,
        bidding_mode: existing.bidding_mode,
        inactivity_timeout_seconds: existing.inactivity_timeout_seconds,
      },
      new_value: {
        name: value.name,
        slug: value.slug,
        minimum_bid: value.minimumBid,
        current_bid: nextCurrentBid,
        cv_requirement: value.cvRequirement,
        bid_increment: value.bidIncrement,
        maximum_bid: companyValues.maximum_bid,
        withdrawal_penalty_percent: companyValues.withdrawal_penalty_percent,
        response_duration_minutes: companyValues.response_duration_minutes,
        bidding_mode: companyValues.bidding_mode,
        inactivity_timeout_seconds: companyValues.inactivity_timeout_seconds,
      },
    });

    revalidatePath("/admin/companies");
    revalidatePath(`/admin/companies/${value.companyId}/edit`);
    revalidatePath("/student", "layout");
    revalidatePath("/analytics");
    return { ok: true, message: `${value.name} was updated successfully.` };
  } catch (error) {
    return resultFromError(error);
  }
}

export async function markNotificationRead(notificationId: string) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", profile.id);
  if (error) throw new Error(error.message);
  revalidatePath("/student");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
