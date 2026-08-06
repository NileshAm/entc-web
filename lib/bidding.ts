import type { ApplicationStatus } from "@/lib/types";

export function withdrawalPenaltyApplies(
  applicationStatus: ApplicationStatus | undefined,
) {
  return applicationStatus !== undefined
    && ["active_bid", "confirmed", "confirmation_required"].includes(applicationStatus);
}

export function calculateIncreaseWithdrawalCharge({
  initialBid,
  currentBid,
  penaltyPercent,
  availablePoints,
  reservedPoints,
}: {
  initialBid: number;
  currentBid: number;
  penaltyPercent: number;
  availablePoints: number;
  reservedPoints: number;
}) {
  const increasePortion = Math.max(0, currentBid - initialBid);
  const calculatedCharge = initialBid + Math.ceil(
    increasePortion * penaltyPercent / 100,
  );
  const usablePoints = Math.max(0, availablePoints) + Math.max(0, reservedPoints);
  const appliedCharge = Math.min(calculatedCharge, usablePoints);

  return {
    increasePortion,
    calculatedCharge,
    appliedCharge,
    capped: appliedCharge < calculatedCharge,
  };
}
