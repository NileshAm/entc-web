import type { CompanyStatus } from "@/lib/types";

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
