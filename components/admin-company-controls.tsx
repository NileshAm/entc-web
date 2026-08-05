"use client";

import { useState, useTransition } from "react";
import { CirclePause, CirclePlay, Gavel, LoaderCircle, LockKeyhole, Pencil, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { changeCompanyStatus, finalizeCompany, increaseCompanyBid } from "@/app/actions";
import type { ActionState, Company } from "@/lib/types";

export function AdminCompanyControls({ company, compact = false }: { company: Company; compact?: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"increase" | "finalize" | "cancel" | null>(null);
  const [feedback, setFeedback] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionState>) {
    setFeedback(null);
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      if (result.ok) {
        setDialog(null);
        router.refresh();
      }
    });
  }

  function handleIncrease(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const custom = String(form.get("bid")).trim();
    run(() => increaseCompanyBid(company.id, custom ? Number(custom) : undefined, String(form.get("reason") || "")));
  }

  if (compact) {
    return (
      <div className="compact-controls">
        {company.status === "upcoming" && <button onClick={() => run(() => changeCompanyStatus(company.id, "open"))}><CirclePlay /> Open</button>}
        {company.status === "open" && <button onClick={() => run(() => changeCompanyStatus(company.id, "paused"))}><CirclePause /> Pause</button>}
        {company.status === "paused" && <button onClick={() => run(() => changeCompanyStatus(company.id, "open"))}><CirclePlay /> Resume</button>}
        <Link href={`/admin/companies/${company.id}/edit`} aria-label={`Edit ${company.name}`}><Pencil /> Edit</Link>
      </div>
    );
  }

  return (
    <>
      <div className="admin-control-row">
        {company.status === "upcoming" && <button className="button button-primary" disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "open"))}><CirclePlay size={17} /> Open bidding</button>}
        {company.status === "open" && <>
          <button className="button button-ghost" disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "paused"))}><CirclePause size={17} /> Pause</button>
          <button className="button button-warning" disabled={pending || company.applicant_count <= company.cv_requirement} onClick={() => setDialog("increase")}><Gavel size={17} /> Increase bid</button>
          <button className="button button-ghost" disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "closed"))}><LockKeyhole size={17} /> Close</button>
        </>}
        {company.status === "paused" && <button className="button button-primary" disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "open"))}><CirclePlay size={17} /> Resume</button>}
        {["closed", "paused", "open"].includes(company.status) && <button className="button button-dark" disabled={pending || company.pending_count > 0 || company.applicant_count > company.cv_requirement} onClick={() => setDialog("finalize")}><LockKeyhole size={17} /> Finalize</button>}
        {!["finalized", "cancelled"].includes(company.status) && <button className="button button-danger-ghost" disabled={pending} onClick={() => setDialog("cancel")}><XCircle size={17} /> Cancel</button>}
      </div>
      {pending && <p className="control-progress"><LoaderCircle className="spin" size={16} /> Processing secure transaction…</p>}
      {feedback && !dialog && <p className={feedback.ok ? "inline-success" : "inline-error"}>{feedback.message}</p>}

      {dialog && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><section className="modal-card" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setDialog(null)}><X /></button>
        {dialog === "increase" && <form onSubmit={handleIncrease}><span className="modal-kicker">BID CONTROL</span><h2>Increase the {company.name} bid</h2><p>{company.applicant_count} applicants are competing for {company.cv_requirement} CV slots. Every active applicant will need to respond again.</p><div className="point-preview"><div><span>Current bid</span><strong>{company.current_bid} pts</strong></div><div><span>Standard increment</span><strong>+{company.bid_increment} pts</strong></div><div className="point-preview-total"><span>Suggested new bid</span><strong>{company.current_bid + company.bid_increment} pts</strong></div></div><label className="field-label">Custom bid (optional)<input name="bid" type="number" min={company.current_bid + 1} max={company.maximum_bid ?? undefined} placeholder={String(company.current_bid + company.bid_increment)} /></label><label className="field-label">Reason (optional)<textarea name="reason" rows={2} placeholder="Oversubscribed after the first round" /></label><button className="button button-warning modal-primary" disabled={pending}>{pending ? <LoaderCircle className="spin" /> : "Confirm bid increase"}</button></form>}
        {dialog === "finalize" && <><span className="modal-kicker">ATOMIC FINALIZATION</span><h2>Finalize {company.name}?</h2><p>This will deduct {company.current_bid} points from each of the {company.confirmed_count} eligible applicants. The complete operation rolls back if any deduction fails.</p><div className="point-preview"><div><span>CV slots</span><strong>{company.cv_requirement}</strong></div><div><span>Eligible applicants</span><strong>{company.confirmed_count}</strong></div><div className="point-preview-total"><span>Total points</span><strong>{company.current_bid * company.confirmed_count}</strong></div></div><button className="button button-dark modal-primary" onClick={() => run(() => finalizeCompany(company.id))} disabled={pending}>{pending ? <LoaderCircle className="spin" /> : "Finalize & deduct points"}</button></>}
        {dialog === "cancel" && <><span className="modal-kicker">CANCEL SESSION</span><h2>Cancel {company.name} bidding?</h2><p>All active applications will be cancelled and every reserved point will be released. This action is recorded in the audit log.</p><button className="button button-danger modal-primary" onClick={() => run(() => changeCompanyStatus(company.id, "cancelled"))} disabled={pending}>{pending ? <LoaderCircle className="spin" /> : "Cancel session & release points"}</button></>}
        {feedback && <p className={feedback.ok ? "inline-success" : "inline-error"}>{feedback.message}</p>}
      </section></div>}
    </>
  );
}
