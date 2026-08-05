import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (error || !userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  return (profile as Profile | null) ?? null;
}

export async function requireProfile(allowedRoles?: UserRole[]) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (profile.account_status !== "active") {
    redirect("/login?error=account-disabled");
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    redirect(profile.role === "student" ? "/student" : "/admin");
  }

  return profile;
}
