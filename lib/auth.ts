import "server-only";

import { redirect, unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types";

// Layouts and pages frequently ask for the same profile during one render.
// React cache keeps that to one JWT verification and one profile query per
// request without sharing session data between Worker requests.
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
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
    // cookies() uses framework exceptions to opt authenticated routes out of
    // static generation. Let Next.js handle those instead of reporting them
    // as Supabase failures during `next build`.
    unstable_rethrow(error);

    // Auth/session failures are expected at this boundary (for example, a
    // stale refresh token). Fail closed without exposing tokens or PII.
    console.error("auth.profile_lookup_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
});

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
