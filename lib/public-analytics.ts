import { z } from "zod";
import type { PublicCompanyAnalytics } from "@/lib/types";

const publicAnalyticsRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  industry: z.string(),
  location: z.string(),
  cv_requirement: z.number().int().positive(),
  current_bid: z.number().int().nonnegative(),
  opens_at: z.string().nullable(),
  closes_at: z.string().nullable(),
  status: z.enum([
    "upcoming",
    "open",
    "paused",
    "bid_increase_pending",
    "closed",
    "finalized",
    "cancelled",
  ]),
  applicant_count: z.number().int().nonnegative(),
});

export function normalizePublicCompanyAnalytics(row: unknown): PublicCompanyAnalytics {
  const company = publicAnalyticsRowSchema.parse(row);
  return {
    id: company.id,
    name: company.name,
    industry: company.industry,
    location: company.location,
    cv_requirement: company.cv_requirement,
    current_bid: company.current_bid,
    opens_at: company.opens_at,
    closes_at: company.closes_at,
    status: company.status,
    applicant_count: company.applicant_count,
    demand_ratio: company.applicant_count / company.cv_requirement,
  };
}
