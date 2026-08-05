"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { CompanyCard } from "@/components/company-card";
import type { Company } from "@/lib/types";

export function CompanyList({ companies, availablePoints }: { companies: Company[]; availablePoints: number }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = useMemo(() => companies.filter((company) => {
    const matchesQuery = `${company.name} ${company.industry} ${company.location}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "all" || company.status === status);
  }), [companies, query, status]);

  return (
    <>
      <div className="filter-bar">
        <label className="search-field"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, domain, or location" /></label>
        <label className="select-field"><SlidersHorizontal size={17} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="open">Open now</option><option value="upcoming">Upcoming</option><option value="paused">Paused</option><option value="finalized">Finalized</option></select></label>
        <span className="result-count">{filtered.length} {filtered.length === 1 ? "company" : "companies"}</span>
      </div>
      {filtered.length ? <div className="company-grid">{filtered.map((company) => <CompanyCard key={company.id} company={company} availablePoints={availablePoints} />)}</div> : <div className="empty-state"><Search /><h3>No matching companies</h3><p>Try a different name, domain, location, or status.</p></div>}
    </>
  );
}
