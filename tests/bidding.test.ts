import { describe, expect, it } from "vitest";
import { calculateIncreaseWithdrawalCharge } from "../lib/bidding";

describe("increase withdrawal charge", () => {
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
