"use client";

import { useMemo, useState, useTransition } from "react";
import { LoaderCircle, Search, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { setStudentIpPoints } from "@/app/actions";
import { availablePoints, initials, ipPointTotal } from "@/lib/business";
import type { ActionState, Profile } from "@/lib/types";

export function StudentTable({ students, readOnly = false }: { students: Profile[]; readOnly?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Profile | null>(null);
  const [feedback, setFeedback] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const filtered = useMemo(() => students.filter((student) => `${student.full_name} ${student.registration_number} ${student.email}`.toLowerCase().includes(query.toLowerCase())), [query, students]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await setStudentIpPoints(selected.id, Number(form.get("total")), String(form.get("reason")));
      setFeedback(result);
      if (result.ok) { router.refresh(); setTimeout(() => setSelected(null), 800); }
    });
  }

  return <>
    <div className="filter-bar"><label className="search-field"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, registration, or email" /></label><span className="select-field static"><SlidersHorizontal size={17} /> {filtered.length} students</span></div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Student</th><th>IP total</th><th>Available</th><th>Reserved</th><th>Spent</th><th>Status</th>{!readOnly && <th />}</tr></thead><tbody>{filtered.map((student) => <tr key={student.id}><td><div className="table-person"><span className="avatar">{initials(student.full_name)}</span><span><strong>{student.full_name}</strong><small>{student.registration_number ?? student.email}</small></span></div></td><td>{ipPointTotal(student)}</td><td><strong>{availablePoints(student)}</strong></td><td>{student.reserved_points}</td><td>{student.spent_points}</td><td><span className={`status-badge status-${student.account_status}`}>{student.account_status}</span></td>{!readOnly && <td><button className="table-action" onClick={() => { setSelected(student); setFeedback(null); }}>Edit IP points</button></td>}</tr>)}</tbody></table></div>
    {!readOnly && selected && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><form className="modal-card" onSubmit={submit}><button type="button" className="modal-close" onClick={() => setSelected(null)}><X /></button><span className="modal-kicker">IP POINT ALLOCATION</span><h2>Set {selected.full_name}’s IP points</h2><p>Current IP total: <strong>{ipPointTotal(selected)} points</strong>. Reserved and spent points remain deducted, and every change is audited.</p><label className="field-label">New IP total<input name="total" type="number" min={selected.reserved_points + selected.spent_points} max="2147483647" step="1" required defaultValue={ipPointTotal(selected)} /></label><label className="field-label">Reason<textarea name="reason" required minLength={3} rows={3} placeholder="Explain why this IP total is being changed" /></label>{feedback && <p className={feedback.ok ? "inline-success" : "inline-error"}>{feedback.message}</p>}<button className="button button-primary modal-primary" disabled={pending}>{pending ? <LoaderCircle className="spin" /> : "Save IP total"}</button></form></div>}
  </>;
}
