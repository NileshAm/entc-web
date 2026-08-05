import { describe, expect, it } from "vitest";
import {
  availablePoints,
  demandCategory,
  formatStatus,
  initials,
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
  ] as const)("formats participant status %s", (status, expected) => {
    expect(participantStatusLabel(status)).toBe(expected);
  });
});
