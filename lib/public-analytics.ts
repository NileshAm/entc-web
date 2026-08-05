import { z } from "zod";
import type { PublicCompanyAnalytics } from "@/lib/types";

const publicParticipantSchema = z.object({
  full_name: z.string().min(1),
  response_state: z.enum([
    "staying",
    "pending",
    "selected",
    "finalized",
    "not_selected",
    "withdrawn",
  ]),
  bid_amount: z.number().int().nonnegative(),
  rank_position: z.number().int().positive().nullable(),
  is_currently_selected: z.boolean(),
});

const publicAnalyticsRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  industry: z.string(),
  location: z.string(),
  cv_requirement: z.number().int().positive(),
  current_bid: z.number().int().nonnegative(),
  maximum_bid: z.number().int().positive().nullable(),
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
  bidding_mode: z.enum(["committee", "automatic"]),
  inactivity_timeout_seconds: z.number().int().min(30),
  auto_closes_at: z.string().nullable(),
  participants: z.array(publicParticipantSchema),
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
    maximum_bid: company.maximum_bid,
    opens_at: company.opens_at,
    closes_at: company.closes_at,
    status: company.status,
    applicant_count: company.applicant_count,
    bidding_mode: company.bidding_mode,
    inactivity_timeout_seconds: company.inactivity_timeout_seconds,
    auto_closes_at: company.auto_closes_at,
    participants: company.participants,
    demand_ratio: company.applicant_count / company.cv_requirement,
  };
}
