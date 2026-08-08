import type { ApplicationStatus, CompanyStatus } from "@/lib/types";

const activeApplicationStatuses: ApplicationStatus[] = [
  "active_bid",
  "confirmed",
  "confirmation_required",
];

const inactiveApplicationStatuses: ApplicationStatus[] = [
  "withdrawn",
  "cancelled",
  "not_selected",
];

export function isUpcomingCompany(companyStatus: CompanyStatus) {
  return ["upcoming", "registration_open"].includes(companyStatus);
}

export function canJoinCompany(
  companyStatus: CompanyStatus,
  applicationStatus: ApplicationStatus | undefined,
) {
  return companyStatus === "registration_open"
    && (applicationStatus === undefined
      || inactiveApplicationStatuses.includes(applicationStatus));
}

export function canSubmitAutomaticBid(
  companyStatus: CompanyStatus,
  applicationStatus: ApplicationStatus | undefined,
) {
  return companyStatus === "open"
    && applicationStatus !== undefined
    && ["active_bid", "confirmed"].includes(applicationStatus);
}

export function canPlaceAutomaticRegistrationBid(
  companyStatus: CompanyStatus,
  applicationStatus: ApplicationStatus | undefined,
) {
  return companyStatus === "registration_open"
    && (applicationStatus === undefined
      || [
        "active_bid",
        "confirmed",
        ...inactiveApplicationStatuses,
      ].includes(applicationStatus));
}

export function withdrawalPenaltyApplies(
  applicationStatus: ApplicationStatus | undefined,
  companyStatus: CompanyStatus,
) {
  return companyStatus !== "registration_open"
    && applicationStatus !== undefined
    && activeApplicationStatuses.includes(applicationStatus);
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
