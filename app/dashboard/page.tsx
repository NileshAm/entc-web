import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";

export default async function DashboardPage() {
  const profile = await requireProfile();
  redirect(profile.role === "student" ? "/student" : "/admin");
}
