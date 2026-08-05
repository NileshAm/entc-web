import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;

    if (error || !userId) return null;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileError) {
      console.warn("auth.profile_lookup_rejected", {
        code: profileError.code,
      });
      return null;
    }

    return (profile as Profile | null) ?? null;
  } catch (error) {
    // Auth/session failures are expected at this boundary (for example, a
    // stale refresh token). Fail closed without exposing tokens or PII.
    console.error("auth.profile_lookup_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
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
