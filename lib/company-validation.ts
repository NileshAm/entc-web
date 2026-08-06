import { z } from "zod";

export const companySchema = z.object({
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
  withdrawalPenaltyPercent: z.coerce.number().int().min(0).max(100),
  responseDurationMinutes: z.coerce.number().int().min(1).max(1440),
  biddingMode: z.enum(["committee", "automatic"]),
  inactivityTimeoutSeconds: z.coerce.number().int().min(30).max(86400),
  opensAt: z.string(),
  closesAt: z.string(),
});

export const companyUpdateSchema = companySchema.extend({
  companyId: z.string().uuid("Invalid company reference."),
});

export type CompanyInput = z.infer<typeof companySchema>;

export function parseCompanyDateTime(value: string) {
  if (!value) return null;
  const localValue = value.length === 16 ? `${value}:00` : value;
  const hasTimeZone = /(?:z|[+-]\d{2}:\d{2})$/i.test(localValue);
  const timestamp = new Date(hasTimeZone ? localValue : `${localValue}+05:30`);
  if (Number.isNaN(timestamp.getTime())) throw new Error("Enter a valid company schedule.");
  return timestamp.toISOString();
}

export function companyInputValues(value: CompanyInput) {
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
    withdrawal_penalty_percent: value.withdrawalPenaltyPercent,
    response_duration_minutes: value.responseDurationMinutes,
    bidding_mode: value.biddingMode,
    inactivity_timeout_seconds: value.inactivityTimeoutSeconds,
    opens_at: parseCompanyDateTime(value.opensAt),
    closes_at: parseCompanyDateTime(value.closesAt),
  };
}
