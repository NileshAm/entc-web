import type { BidParticipant, BiddingMode, CompanyStatus } from "@/lib/types";

export function availablePoints(profile: {
  initial_points: number;
  point_adjustments: number;
  reserved_points: number;
  spent_points: number;
}) {
  return (
    profile.initial_points +
    profile.point_adjustments -
    profile.reserved_points -
    profile.spent_points
  );
}

export function ipPointTotal(profile: {
  initial_points: number;
  point_adjustments: number;
}) {
  return profile.initial_points + profile.point_adjustments;
}

export function demandCategory(ratio: number) {
  if (ratio < 0.75) return "Low demand";
  if (ratio < 1) return "Moderate demand";
  if (ratio === 1) return "Full";
  if (ratio <= 1.5) return "Oversubscribed";
  return "Highly oversubscribed";
}

export function demandTone(ratio: number) {
  if (ratio > 1) return "danger";
  if (ratio === 1) return "success";
  return "neutral";
}

export function formatStatus(status: CompanyStatus | string) {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function participantStatusLabel(status: BidParticipant["response_state"]) {
  const labels: Record<BidParticipant["response_state"], string> = {
    staying: "Staying",
    pending: "Response pending",
    selected: "Selected",
    finalized: "Finalized",
    not_selected: "Not selected",
    withdrawn: "Withdrawn",
  };
  return labels[status];
}

export function participantRankingLabel(
  participant: BidParticipant,
  biddingMode: BiddingMode,
  cvRequirement: number,
) {
  const rank = participant.rank_position === null
    ? ""
    : `#${participant.rank_position} · `;
  const bid = `${participant.bid_amount} pts`;

  if (["withdrawn", "not_selected", "selected", "finalized"].includes(
    participant.response_state,
  )) {
    return `${rank}${bid} · ${participantStatusLabel(participant.response_state)}`;
  }

  if (biddingMode === "automatic") {
    return `${rank}${bid} · ${participant.is_currently_selected ? "Top slots" : "Outside cutoff"}`;
  }

  const standing = participant.is_currently_selected
    ? participantStatusLabel(participant.response_state)
    : participant.rank_position === cvRequirement + 1
      ? "Next to be removed"
      : "Outside cutoff";
  return `${rank}${bid} reserved · ${standing}`;
}

export function formatDateTime(value: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
