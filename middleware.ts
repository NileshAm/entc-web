import type { NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16 normally uses proxy.ts (Node runtime), but the current Cloudflare
// OpenNext adapter does not yet support Node middleware. The legacy middleware
// filename keeps this session refresh at the supported middleware boundary.
export async function middleware(request: NextRequest) {
  if (!isSupabaseConfigured()) return;
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
