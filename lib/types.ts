export type UserRole = "student" | "admin" | "viewer";

export type CompanyStatus =
  | "upcoming"
  | "open"
  | "paused"
  | "bid_increase_pending"
  | "closed"
  | "finalized"
  | "cancelled";

export type ApplicationStatus =
  | "active_bid"
  | "confirmation_required"
  | "confirmed"
  | "withdrawn"
  | "selected"
  | "not_selected"
  | "finalized"
  | "cancelled";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  registration_number: string | null;
  role: UserRole;
  initial_points: number;
  point_adjustments: number;
  reserved_points: number;
  spent_points: number;
  account_status: "active" | "disabled";
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  industry: string;
  location: string;
  available_roles: string[];
  required_skills: string[];
  internship_duration: string | null;
  website_url: string | null;
  cv_requirement: number;
  minimum_bid: number;
  current_bid: number;
  bid_increment: number;
  maximum_bid: number | null;
  withdrawal_penalty_percent: number;
  opens_at: string | null;
  closes_at: string | null;
  response_duration_minutes: number;
  status: CompanyStatus;
  finalized_at: string | null;
  applicant_count: number;
  confirmed_count: number;
  pending_count: number;
  withdrawal_count: number;
  demand_ratio: number;
  application?: Application | null;
  participants?: BidParticipant[];
}

export interface BidParticipant {
  full_name: string;
  response_state: "staying" | "pending";
}

export interface PublicCompanyAnalytics {
  id: string;
  name: string;
  industry: string;
  location: string;
  cv_requirement: number;
  current_bid: number;
  maximum_bid: number | null;
  opens_at: string | null;
  closes_at: string | null;
  status: CompanyStatus;
  applicant_count: number;
  demand_ratio: number;
}

export interface Application {
  id: string;
  student_id: string;
  company_id: string;
  initial_bid: number;
  accepted_bid: number;
  reserved_points: number;
  final_points_deducted: number;
  withdrawal_charge: number;
  bid_response_penalty_percent: number | null;
  status: ApplicationStatus;
  applied_at: string;
  bid_updated_at: string;
  confirmation_deadline: string | null;
  confirmed_at: string | null;
  withdrawn_at: string | null;
  finalized_at: string | null;
  company?: Pick<Company, "id" | "name" | "slug" | "logo_url" | "industry">;
  profile?: Pick<Profile, "id" | "full_name" | "registration_number" | "email">;
}

export interface PointTransaction {
  id: string;
  type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  description: string;
  status: string;
  created_at: string;
  company?: { name: string } | null;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  kind: string;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_role: UserRole | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  created_at: string;
  actor?: { full_name: string; email: string } | null;
}

export interface ActionState {
  ok: boolean;
  message: string;
}
