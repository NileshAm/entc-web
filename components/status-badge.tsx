import { Circle } from "lucide-react";
import { formatStatus } from "@/lib/business";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status}`}>
      <Circle size={8} fill="currentColor" /> {formatStatus(status)}
    </span>
  );
}
