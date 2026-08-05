import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

export async function updateSession(request: NextRequest) {
  const { url, publishableKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  try {
    // getClaims validates the JWT signature and refreshes expired sessions.
    const { error } = await supabase.auth.getClaims();
    if (error) {
      console.warn("auth.session_refresh_rejected", {
        name: error.name,
        code: error.code,
      });
    }
  } catch (error) {
    // A transient Auth/JWKS failure must not take down public pages. Protected
    // routes still fail closed in requireProfile(). Never log cookie values.
    console.error("auth.session_refresh_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    response.headers.set(
      "Cache-Control",
      "private, no-cache, no-store, must-revalidate, max-age=0",
    );
    response.headers.set("Expires", "0");
    response.headers.set("Pragma", "no-cache");
  }

  return response;
}
