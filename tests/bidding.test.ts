import { describe, expect, it } from "vitest";
import {
  canJoinCompany,
  canPlaceAutomaticRegistrationBid,
  canSubmitAutomaticBid,
  calculateIncreaseWithdrawalCharge,
  isUpcomingCompany,
  withdrawalPenaltyApplies,
} from "../lib/bidding";

describe("pre-bidding registration", () => {
  it("groups registration-open companies with upcoming companies", () => {
    expect(isUpcomingCompany("upcoming")).toBe(true);
    expect(isUpcomingCompany("registration_open")).toBe(true);
    expect(isUpcomingCompany("open")).toBe(false);
  });

  it("allows new and previously withdrawn students to join only during registration", () => {
    expect(canJoinCompany("registration_open", undefined)).toBe(true);
    expect(canJoinCompany("registration_open", "withdrawn")).toBe(true);
    expect(canJoinCompany("open", undefined)).toBe(false);
    expect(canJoinCompany("registration_open", "active_bid")).toBe(false);
  });

  it("locks automatic bidding to the registered active cohort", () => {
    expect(canSubmitAutomaticBid("open", "active_bid")).toBe(true);
    expect(canSubmitAutomaticBid("open", "confirmed")).toBe(true);
    expect(canSubmitAutomaticBid("open", undefined)).toBe(false);
    expect(canSubmitAutomaticBid("open", "withdrawn")).toBe(false);
    expect(canSubmitAutomaticBid("registration_open", "active_bid")).toBe(false);
  });

  it("allows an initial automatic bid during registration", () => {
    expect(canPlaceAutomaticRegistrationBid("registration_open", undefined)).toBe(true);
    expect(canPlaceAutomaticRegistrationBid("registration_open", "withdrawn")).toBe(true);
    expect(canPlaceAutomaticRegistrationBid("registration_open", "active_bid")).toBe(true);
    expect(canPlaceAutomaticRegistrationBid("registration_open", "confirmed")).toBe(true);
    expect(canPlaceAutomaticRegistrationBid("open", undefined)).toBe(false);
  });
});

describe("withdrawal penalty applicability", () => {
  it("does not charge a withdrawal before bidding starts", () => {
    expect(withdrawalPenaltyApplies("active_bid", "registration_open")).toBe(false);
  });

  it("charges a self-withdrawal while a manual decision is pending", () => {
    expect(withdrawalPenaltyApplies("confirmation_required", "bid_increase_pending")).toBe(true);
  });

  it("charges an active or confirmed manual self-withdrawal", () => {
    expect(withdrawalPenaltyApplies("active_bid", "open")).toBe(true);
    expect(withdrawalPenaltyApplies("confirmed", "paused")).toBe(true);
  });

  it("continues to charge automatic-bid withdrawals", () => {
    expect(withdrawalPenaltyApplies("active_bid", "open")).toBe(true);
  });

  it("does not calculate a new penalty after withdrawal is complete", () => {
    expect(withdrawalPenaltyApplies("withdrawn", "open")).toBe(false);
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
