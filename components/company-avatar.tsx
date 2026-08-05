import { Building2 } from "lucide-react";
import Image from "next/image";
import { initials } from "@/lib/business";

export function CompanyAvatar({ name, logoUrl, large = false }: { name: string; logoUrl?: string | null; large?: boolean }) {
  return (
    <span className={`company-avatar ${large ? "large" : ""}`}>
      {logoUrl ? <Image src={logoUrl} alt={`${name} logo`} width={64} height={64} unoptimized /> : name ? initials(name) : <Building2 />}
    </span>
  );
}
