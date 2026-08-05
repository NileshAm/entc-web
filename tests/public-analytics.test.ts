import { describe, expect, it } from "vitest";
import { normalizePublicCompanyAnalytics } from "../lib/public-analytics";

describe("public analytics DTO", () => {
  it("keeps only public company statistics", () => {
    const company = normalizePublicCompanyAnalytics({
      id: "6e519ae4-208d-4413-87c5-62be7f73eaf7",
      name: "Example Company",
      industry: "Software",
      location: "Colombo",
      cv_requirement: 10,
      current_bid: 25,
      maximum_bid: 80,
      opens_at: null,
      closes_at: null,
      status: "open",
      applicant_count: 15,
      created_by: "private-admin-id",
      internal_notes: "private committee notes",
      contact_email: "private@example.com",
    });

    expect(company.demand_ratio).toBe(1.5);
    expect(company).not.toHaveProperty("created_by");
    expect(company).not.toHaveProperty("internal_notes");
    expect(company).not.toHaveProperty("contact_email");
  });
});
