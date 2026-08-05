"use client";

import { useState, useTransition } from "react";
import {
  CirclePause,
  CirclePlay,
  Gavel,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  changeCompanyStatus,
  finalizeAutomaticBidding,
  finalizeCompany,
  increaseCompanyBid,
} from "@/app/actions";
import type { ActionState, Company } from "@/lib/types";

export function AdminCompanyControls({
  company,
  compact = false,
}: {
  company: Company;
  compact?: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"increase" | "finalize" | "autoFinalize" | "cancel" | null>(null);
  const [incrementAmount, setIncrementAmount] = useState(company.bid_increment);
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
    run(() => increaseCompanyBid(
      company.id,
      company.current_bid + incrementAmount,
      String(form.get("reason") ?? ""),
    ));
  }

  function openIncreaseDialog() {
    setIncrementAmount(Math.min(
      company.bid_increment,
      company.maximum_bid === null
        ? company.bid_increment
        : company.maximum_bid - company.current_bid,
    ));
    setFeedback(null);
    setDialog("increase");
  }

  const canIncrease = company.status === "open" &&
    company.bidding_mode === "committee" &&
    company.applicant_count > company.cv_requirement &&
    company.pending_count === 0 &&
    (company.maximum_bid === null || company.current_bid < company.maximum_bid);
  const maximumIncrement = company.maximum_bid === null
    ? undefined
    : company.maximum_bid - company.current_bid;
  const nextBid = company.current_bid + incrementAmount;
  const invalidIncrement = !Number.isInteger(incrementAmount) ||
    incrementAmount <= 0 ||
    (maximumIncrement !== undefined && incrementAmount > maximumIncrement);

  const dialogs = dialog && (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}>
      <section className="modal-card" role="dialog" aria-modal="true">
        <button className="modal-close" onClick={() => setDialog(null)} aria-label="Close"><X /></button>

        {dialog === "increase" && (
          <form onSubmit={handleIncrease}>
            <span className="modal-kicker">INCREASE CURRENT BID</span>
            <h2>Increase {company.name} bid?</h2>
            <p>Set the increase for this round on the fly. Every student currently in the session will receive a Stay or Withdraw request with a {company.response_duration_minutes}-minute deadline.</p>
            <div className="point-preview">
              <div><span>Current bid</span><strong>{company.current_bid} pts</strong></div>
              <div><span>Increase this round</span><strong>+ {Number.isFinite(incrementAmount) ? incrementAmount : 0} pts</strong></div>
              <div className="point-preview-total"><span>New current bid</span><strong>{Number.isFinite(nextBid) ? nextBid : company.current_bid} pts</strong></div>
            </div>
            <label className="field-label">
              Increase by
              <input
                name="increment"
                type="number"
                inputMode="numeric"
                min="1"
                max={maximumIncrement}
                step="1"
                value={incrementAmount}
                onChange={(event) => setIncrementAmount(Number(event.target.value))}
                required
              />
            </label>
            <label className="field-label">
              Reason (optional)
              <textarea name="reason" rows={2} placeholder="Company remains oversubscribed" />
            </label>
            <p className="target-warning">Withdrawing students pay their base bid plus {company.withdrawal_penalty_percent}% of the increase portion.</p>
            <button className="button button-warning modal-primary" disabled={pending || invalidIncrement}>
              {pending ? <LoaderCircle className="spin" /> : "Increase bid & request responses"}
            </button>
          </form>
        )}

        {dialog === "finalize" && (
          <>
            <span className="modal-kicker">ATOMIC FINALIZATION</span>
            <h2>Finalize {company.name}?</h2>
            <p>The current bid will move from reserved to spent points for every student still in the session.</p>
            <div className="point-preview">
              <div><span>Current bid</span><strong>{company.current_bid} pts</strong></div>
              <div><span>Students staying</span><strong>{company.confirmed_count}</strong></div>
              <div className="point-preview-total"><span>Total deduction</span><strong>{company.current_bid * company.confirmed_count} pts</strong></div>
            </div>
            <button className="button button-dark modal-primary" onClick={() => run(() => finalizeCompany(company.id))} disabled={pending}>
              {pending ? <LoaderCircle className="spin" /> : "Finalize & deduct points"}
            </button>
          </>
        )}

        {dialog === "autoFinalize" && (
          <>
            <span className="modal-kicker">CLOSE AUTOMATIC AUCTION</span>
            <h2>Close {company.name} now?</h2>
            <p>The top {company.cv_requirement} bids will be selected by bid amount. Equal bids favor the earlier submission. Winners spend their individual bid and all other reservations are released.</p>
            <div className="point-preview">
              <div><span>Applicants</span><strong>{company.applicant_count}</strong></div>
              <div><span>Available slots</span><strong>{company.cv_requirement}</strong></div>
              <div className="point-preview-total"><span>Highest bid</span><strong>{company.current_bid} pts</strong></div>
            </div>
            <button className="button button-dark modal-primary" onClick={() => run(() => finalizeAutomaticBidding(company.id))} disabled={pending}>
              {pending ? <LoaderCircle className="spin" /> : "Close & select top bids"}
            </button>
          </>
        )}

        {dialog === "cancel" && (
          <>
            <span className="modal-kicker">CANCEL SESSION</span>
            <h2>Cancel {company.name} bidding?</h2>
            <p>All active applications will be cancelled and reserved points released. Withdrawal charges already spent are not reversed.</p>
            <button className="button button-danger modal-primary" onClick={() => run(() => changeCompanyStatus(company.id, "cancelled"))} disabled={pending}>
              {pending ? <LoaderCircle className="spin" /> : "Cancel session & release reservations"}
            </button>
          </>
        )}

        {feedback && <p className={feedback.ok ? "inline-success" : "inline-error"}>{feedback.message}</p>}
      </section>
    </div>
  );

  if (compact) {
    if (company.bidding_mode === "automatic") {
      return (
        <>
          <div className="compact-controls">
            {company.status === "upcoming" && <button disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "open"))}><CirclePlay /> Open</button>}
            {company.status === "open" && <button disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "paused"))}><CirclePause /> Pause</button>}
            {company.status === "paused" && <button disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "open"))}><CirclePlay /> Resume</button>}
            {["open", "paused"].includes(company.status) && <button disabled={pending} onClick={() => setDialog("autoFinalize")}><LockKeyhole /> Close now</button>}
            <Link href={`/admin/companies/${company.id}/edit`} aria-label={`Edit ${company.name}`}><Pencil /> Edit</Link>
          </div>
          {feedback && !dialog && <p className={feedback.ok ? "inline-success" : "inline-error"}>{feedback.message}</p>}
          {dialogs}
        </>
      );
    }
    return (
      <>
        <div className="compact-controls">
          {company.status === "upcoming" && <button disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "open"))}><CirclePlay /> Open</button>}
          {company.status === "open" && <button disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "paused"))}><CirclePause /> Pause</button>}
          {company.status === "paused" && <button disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "open"))}><CirclePlay /> Resume</button>}
          {canIncrease && <button disabled={pending} onClick={openIncreaseDialog}><Gavel /> Increase bid</button>}
          {["open", "paused"].includes(company.status) && <button disabled={pending || company.pending_count > 0 || company.applicant_count > company.cv_requirement} onClick={() => run(() => changeCompanyStatus(company.id, "closed"))}><LockKeyhole /> Close</button>}
          {company.status === "closed" && <button disabled={pending || company.pending_count > 0 || company.applicant_count > company.cv_requirement} onClick={() => setDialog("finalize")}><LockKeyhole /> Finalize</button>}
          <Link href={`/admin/companies/${company.id}/edit`} aria-label={`Edit ${company.name}`}><Pencil /> Edit</Link>
        </div>
        {feedback && !dialog && <p className={feedback.ok ? "inline-success" : "inline-error"}>{feedback.message}</p>}
        {dialogs}
      </>
    );
  }

  return (
    <>
      <div className="admin-control-row">
        {company.status === "upcoming" && <button className="button button-primary" disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "open"))}><CirclePlay size={17} /> Open {company.bidding_mode === "automatic" ? "automatic auction" : "bidding"}</button>}
        {company.bidding_mode === "automatic" && company.status === "open" && (
          <>
            <button className="button button-ghost" disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "paused"))}><CirclePause size={17} /> Pause timer</button>
            <button className="button button-dark" disabled={pending} onClick={() => setDialog("autoFinalize")}><LockKeyhole size={17} /> Close & select now</button>
          </>
        )}
        {company.bidding_mode === "automatic" && company.status === "paused" && (
          <>
            <button className="button button-primary" disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "open"))}><CirclePlay size={17} /> Resume timer</button>
            <button className="button button-dark" disabled={pending} onClick={() => setDialog("autoFinalize")}><LockKeyhole size={17} /> Close & select now</button>
          </>
        )}
        {company.bidding_mode === "committee" && company.status === "open" && (
          <>
            <button className="button button-ghost" disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "paused"))}><CirclePause size={17} /> Pause</button>
            <button className="button button-warning" disabled={pending || !canIncrease} onClick={openIncreaseDialog}><Gavel size={17} /> Increase bid</button>
            <button className="button button-ghost" disabled={pending || company.pending_count > 0 || company.applicant_count > company.cv_requirement} onClick={() => run(() => changeCompanyStatus(company.id, "closed"))}><LockKeyhole size={17} /> Close</button>
          </>
        )}
        {company.bidding_mode === "committee" && company.status === "paused" && (
          <>
            <button className="button button-primary" disabled={pending} onClick={() => run(() => changeCompanyStatus(company.id, "open"))}><CirclePlay size={17} /> Resume</button>
            <button className="button button-ghost" disabled={pending || company.pending_count > 0 || company.applicant_count > company.cv_requirement} onClick={() => run(() => changeCompanyStatus(company.id, "closed"))}><LockKeyhole size={17} /> Close</button>
          </>
        )}
        {company.bidding_mode === "committee" && company.status === "bid_increase_pending" && <span className="control-progress"><LoaderCircle className="spin" size={16} /> Waiting for {company.pending_count} student responses</span>}
        {company.bidding_mode === "committee" && company.status === "closed" && <button className="button button-dark" disabled={pending || company.pending_count > 0 || company.applicant_count > company.cv_requirement} onClick={() => setDialog("finalize")}><LockKeyhole size={17} /> Finalize</button>}
        {!["finalized", "cancelled"].includes(company.status) && <button className="button button-danger-ghost" disabled={pending} onClick={() => setDialog("cancel")}><XCircle size={17} /> Cancel</button>}
      </div>
      {pending && <p className="control-progress"><LoaderCircle className="spin" size={16} /> Processing secure transaction…</p>}
      {feedback && !dialog && <p className={feedback.ok ? "inline-success" : "inline-error"}>{feedback.message}</p>}
      {dialogs}
    </>
  );
}
