import { describe, expect, it } from "vitest";
import { normalizePublicCompanyAnalytics } from "../lib/public-analytics";

describe("public analytics DTO", () => {
  it("accepts the pre-bidding registration status", () => {
    const company = normalizePublicCompanyAnalytics({
      id: "6e519ae4-208d-4413-87c5-62be7f73eaf7",
      name: "Registration Company",
      industry: "Software",
      location: "Colombo",
      available_roles: [],
      cv_requirement: 5,
      current_bid: 10,
      maximum_bid: null,
      opens_at: null,
      closes_at: null,
      status: "registration_open",
      applicant_count: 2,
      bidding_mode: "committee",
      inactivity_timeout_seconds: 120,
      auto_closes_at: null,
      participants: [],
    });

    expect(company.status).toBe("registration_open");
  });

  it("keeps only public company statistics", () => {
    const company = normalizePublicCompanyAnalytics({
      id: "6e519ae4-208d-4413-87c5-62be7f73eaf7",
      name: "Example Company",
      industry: "Software",
      location: "Colombo",
      available_roles: ["Software Engineer", "QA Engineer"],
      cv_requirement: 10,
      current_bid: 25,
      maximum_bid: 80,
      opens_at: null,
      closes_at: null,
      status: "open",
      applicant_count: 15,
      bidding_mode: "automatic",
      inactivity_timeout_seconds: 120,
      auto_closes_at: "2026-08-06T12:00:00.000Z",
      participants: [
        { full_name: "Nimal Perera", response_state: "staying", bid_amount: 45, rank_position: 1, is_currently_selected: true, email: "private@example.com" },
        { full_name: "Amara Silva", response_state: "pending", bid_amount: 40, rank_position: 2, is_currently_selected: true, registration_number: "200012A" },
        { full_name: "Kamal Fernando", response_state: "withdrawn", bid_amount: 35, rank_position: null, is_currently_selected: false },
      ],
      created_by: "private-admin-id",
      internal_notes: "private committee notes",
      contact_email: "private@example.com",
    });

    expect(company.demand_ratio).toBe(1.5);
    expect(company.available_roles).toEqual(["Software Engineer", "QA Engineer"]);
    expect(company.participants).toEqual([
      { full_name: "Nimal Perera", response_state: "staying", bid_amount: 45, rank_position: 1, is_currently_selected: true },
      { full_name: "Amara Silva", response_state: "pending", bid_amount: 40, rank_position: 2, is_currently_selected: true },
      { full_name: "Kamal Fernando", response_state: "withdrawn", bid_amount: 35, rank_position: null, is_currently_selected: false },
    ]);
    expect(company.participants[0]).not.toHaveProperty("email");
    expect(company.participants[1]).not.toHaveProperty("registration_number");
    expect(company).not.toHaveProperty("created_by");
    expect(company).not.toHaveProperty("internal_notes");
    expect(company).not.toHaveProperty("contact_email");
  });
});
