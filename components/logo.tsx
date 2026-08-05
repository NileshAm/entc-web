import Link from "next/link";
import { Gavel } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="logo" href="/" aria-label="InternBid home">
      <span className="logo-mark"><Gavel size={compact ? 17 : 20} /></span>
      {!compact && <span>Intern<span>Bid</span></span>}
    </Link>
  );
}
