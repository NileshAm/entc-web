"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { getSiteUrl } from "@/lib/env";
import {
  isUniversityEmailAllowed,
  normalizeUniversityDomain,
  studentRegistrationSchema,
} from "@/lib/registration";
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
    const universityDomain = normalizeUniversityDomain(
      process.env.NEXT_PUBLIC_UNIVERSITY_EMAIL_DOMAIN,
    );
    if (!isUniversityEmailAllowed(value.email, universityDomain)) {
      return {
        ok: false,
        message: `Use your @${universityDomain} university email address.`,
      };
    }

    const supabase = await createClient();
    const siteUrl = getSiteUrl().replace(/\/$/, "");
    const { data, error } = await supabase.auth.signUp({
      email: value.email,
      password: value.password,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback?next=/dashboard`,
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
          message: "That university email or student index is already registered.",
        };
      }
      throw new Error(error.message);
    }

    return {
      ok: true,
      message: data.session
        ? "Your student account is ready. Continue to sign in."
        : "Check your university inbox and confirm your email before signing in.",
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
    "Application submitted. Your points are now reserved.",
  );
}

export async function withdrawApplication(applicationId: string) {
  return rpcAction(
    "student",
    "withdraw_application",
    { p_application_id: applicationId },
    "Application withdrawn and reserved points released.",
  );
}

export async function respondToBid(applicationId: string, accept: boolean) {
  return rpcAction(
    "student",
    "respond_to_bid_increase",
    { p_application_id: applicationId, p_accept: accept },
    accept
      ? "New bid accepted and your reservation was updated."
      : "Bid declined. Your application was withdrawn.",
  );
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
  return rpcAction(
    "admin",
    "increase_company_bid",
    {
      p_company_id: companyId,
      p_custom_bid: customBid ?? null,
      p_reason: reason ?? null,
    },
    "Bid increased. Active applicants have been notified.",
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

const companySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  industry: z.string().trim().min(2).max(100),
  location: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000),
  roles: z.string().trim(),
  skills: z.string().trim(),
  cvRequirement: z.coerce.number().int().positive(),
  minimumBid: z.coerce.number().int().nonnegative(),
  bidIncrement: z.coerce.number().int().positive(),
  maximumBid: z.union([z.literal(""), z.coerce.number().int().positive()]),
  opensAt: z.string(),
  closesAt: z.string(),
});

const companyUpdateSchema = companySchema.extend({
  companyId: z.string().uuid("Invalid company reference."),
});

function parseCompanyDateTime(value: string) {
  if (!value) return null;
  const localValue = value.length === 16 ? `${value}:00` : value;
  const timestamp = new Date(`${localValue}+05:30`);
  if (Number.isNaN(timestamp.getTime())) throw new Error("Enter a valid company schedule.");
  return timestamp.toISOString();
}

function companyInputValues(value: z.infer<typeof companySchema>) {
  return {
    name: value.name,
    slug: value.slug,
    industry: value.industry,
    location: value.location,
    description: value.description || null,
    available_roles: value.roles.split(",").map((item) => item.trim()).filter(Boolean),
    required_skills: value.skills.split(",").map((item) => item.trim()).filter(Boolean),
    cv_requirement: value.cvRequirement,
    minimum_bid: value.minimumBid,
    bid_increment: value.bidIncrement,
    maximum_bid: value.maximumBid === "" ? null : value.maximumBid,
    opens_at: parseCompanyDateTime(value.opensAt),
    closes_at: parseCompanyDateTime(value.closesAt),
  };
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
      new_value: { name: value.name, minimum_bid: value.minimumBid },
    });
    revalidatePath("/admin", "layout");
    return { ok: true, message: `${value.name} was added as an upcoming company.` };
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
    const companyValues = companyInputValues(value);
    if (companyValues.closes_at && companyValues.opens_at && companyValues.closes_at <= companyValues.opens_at) {
      return { ok: false, message: "Closing time must be after opening time." };
    }

    const supabase = await createClient();
    const { data: existing, error: readError } = await supabase
      .from("companies")
      .select("id,name,slug,status,current_bid,minimum_bid,cv_requirement,bid_increment,maximum_bid")
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
      },
      new_value: {
        name: value.name,
        slug: value.slug,
        minimum_bid: value.minimumBid,
        current_bid: nextCurrentBid,
        cv_requirement: value.cvRequirement,
        bid_increment: value.bidIncrement,
        maximum_bid: companyValues.maximum_bid,
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
