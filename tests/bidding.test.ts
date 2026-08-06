import { describe, expect, it } from "vitest";
import {
  calculateIncreaseWithdrawalCharge,
  withdrawalPenaltyApplies,
} from "../lib/bidding";

describe("withdrawal penalty applicability", () => {
  it("charges a self-withdrawal while a manual decision is pending", () => {
    expect(withdrawalPenaltyApplies("confirmation_required")).toBe(true);
  });

  it("charges an active or confirmed manual self-withdrawal", () => {
    expect(withdrawalPenaltyApplies("active_bid")).toBe(true);
    expect(withdrawalPenaltyApplies("confirmed")).toBe(true);
  });

  it("continues to charge automatic-bid withdrawals", () => {
    expect(withdrawalPenaltyApplies("active_bid")).toBe(true);
  });

  it("does not calculate a new penalty after withdrawal is complete", () => {
    expect(withdrawalPenaltyApplies("withdrawn")).toBe(false);
  });
});

describe("increase withdrawal charge", () => {
  it("shows the full base bid for a confirmed manual bid with no increase", () => {
    expect(calculateIncreaseWithdrawalCharge({
      initialBid: 25,
      currentBid: 25,
      penaltyPercent: 10,
      availablePoints: 75,
      reservedPoints: 25,
    }).appliedCharge).toBe(25);
  });

  it("charges the base bid plus the rounded-up percentage of the increase", () => {
    expect(calculateIncreaseWithdrawalCharge({
      initialBid: 10,
      currentBid: 25,
      penaltyPercent: 10,
      availablePoints: 80,
      reservedPoints: 10,
    })).toEqual({
      increasePortion: 15,
      calculatedCharge: 12,
      appliedCharge: 12,
      capped: false,
    });
  });

  it("still charges the base bid when the percentage is zero", () => {
    expect(calculateIncreaseWithdrawalCharge({
      initialBid: 10,
      currentBid: 20,
      penaltyPercent: 0,
      availablePoints: 0,
      reservedPoints: 10,
    }).appliedCharge).toBe(10);
  });

  it("caps the charge to prevent a negative balance", () => {
    expect(calculateIncreaseWithdrawalCharge({
      initialBid: 20,
      currentBid: 100,
      penaltyPercent: 100,
      availablePoints: 3,
      reservedPoints: 20,
    })).toMatchObject({
      calculatedCharge: 100,
      appliedCharge: 23,
      capped: true,
    });
  });
});
