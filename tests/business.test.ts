import { describe, expect, it } from "vitest";
import {
  availablePoints,
  demandCategory,
  formatStatus,
  initials,
  participantRankingLabel,
  participantStatusLabel,
} from "../lib/business";

describe("point balance rules", () => {
  it("subtracts reserved and spent points after applying adjustments", () => {
    expect(
      availablePoints({
        initial_points: 100,
        point_adjustments: 10,
        reserved_points: 25,
        spent_points: 30,
      }),
    ).toBe(55);
  });

  it("keeps zero as a valid available balance", () => {
    expect(
      availablePoints({
        initial_points: 40,
        point_adjustments: 0,
        reserved_points: 15,
        spent_points: 25,
      }),
    ).toBe(0);
  });
});

describe("demand categories", () => {
  it.each([
    [0.5, "Low demand"],
    [0.75, "Moderate demand"],
    [0.99, "Moderate demand"],
    [1, "Full"],
    [1.25, "Oversubscribed"],
    [1.5, "Oversubscribed"],
    [1.51, "Highly oversubscribed"],
  ])("maps %s to %s", (ratio, expected) => {
    expect(demandCategory(ratio)).toBe(expected);
  });
});

describe("display helpers", () => {
  it("formats database statuses", () => {
    expect(formatStatus("confirmation_required")).toBe("Confirmation Required");
  });

  it("creates two-letter initials", () => {
    expect(initials("Nimal Perera Silva")).toBe("NP");
  });

  it.each([
    ["staying", "Staying"],
    ["pending", "Response pending"],
    ["selected", "Selected"],
    ["finalized", "Finalized"],
    ["not_selected", "Not selected"],
    ["withdrawn", "Withdrawn"],
  ] as const)("formats participant status %s", (status, expected) => {
    expect(participantStatusLabel(status)).toBe(expected);
  });

  it("keeps withdrawn students visible without a rank", () => {
    expect(participantRankingLabel({
      full_name: "Nimal Perera",
      response_state: "withdrawn",
      bid_amount: 45,
      rank_position: null,
      is_currently_selected: false,
    }, "automatic", 2)).toBe("45 pts · Withdrawn");
  });

  it("labels finalized selected and non-selected ranking outcomes", () => {
    expect(participantRankingLabel({
      full_name: "Nimal Perera",
      response_state: "selected",
      bid_amount: 45,
      rank_position: 1,
      is_currently_selected: true,
    }, "automatic", 1)).toBe("#1 · 45 pts · Selected");
    expect(participantRankingLabel({
      full_name: "Amara Silva",
      response_state: "not_selected",
      bid_amount: 40,
      rank_position: 2,
      is_currently_selected: false,
    }, "automatic", 1)).toBe("#2 · 40 pts · Not selected");
  });
});
