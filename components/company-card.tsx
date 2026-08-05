"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  LoaderCircle,
  MapPin,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { applyToCompany, respondToBid, withdrawApplication } from "@/app/actions";
import { CompanyAvatar } from "@/components/company-avatar";
import { Countdown } from "@/components/countdown";
import { StatusBadge } from "@/components/status-badge";
import { calculateIncreaseWithdrawalCharge } from "@/lib/bidding";
import { demandCategory, formatStatus, participantStatusLabel } from "@/lib/business";
import type { ActionState, Company } from "@/lib/types";

export function CompanyCard({
  company,
  availablePoints,
  featured = false,
}: {
  company: Company;
  availablePoints: number;
  featured?: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<"apply" | "withdraw" | "response" | null>(null);
  const [feedback, setFeedback] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const application = company.application;
  const additionalPoints = Math.max(
    0,
    company.current_bid - (application?.reserved_points ?? 0),
  );
  const withdrawal = calculateIncreaseWithdrawalCharge({
    initialBid: application?.initial_bid ?? 0,
    currentBid: company.current_bid,
    penaltyPercent: application?.bid_response_penalty_percent ?? company.withdrawal_penalty_percent,
    availablePoints,
    reservedPoints: application?.reserved_points ?? 0,
  });
  const hasInsufficientPoints = availablePoints < (
    application?.status === "confirmation_required"
      ? additionalPoints
      : company.current_bid
  );
  const slotsAvailable = Math.max(0, company.cv_requirement - company.applicant_count);

  function run(action: () => Promise<ActionState>) {
    setFeedback(null);
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      if (result.ok) {
        setModal(null);
        router.refresh();
      }
    });
  }

  const canApply = company.status === "open" && (
    !application || ["withdrawn", "cancelled", "not_selected"].includes(application.status)
  );
  const canWithdraw = application &&
    ["active_bid", "confirmed"].includes(application.status) &&
    !["finalized", "cancelled"].includes(company.status);

  return (
    <article className={`company-card ${featured ? "featured" : ""}`}>
      <div className="company-card-head">
        <CompanyAvatar name={company.name} logoUrl={company.logo_url} />
        <div className="company-title"><h3>{company.name}</h3><span>{company.industry}</span></div>
        <StatusBadge status={company.status} />
      </div>
      <div className="company-meta">
        <span><MapPin size={15} /> {company.location}</span>
        <span><Users size={15} /> {company.applicant_count} staying · {company.cv_requirement} slots</span>
      </div>
      <div className="company-tags">
        {company.available_roles.slice(0, 2).map((role) => <span key={role}>{role}</span>)}
      </div>
      <div className="company-bid-row">
        <div><small>CURRENT BID</small><strong>{company.current_bid} <span>pts</span></strong></div>
        <div><small>SLOTS AVAILABLE</small><strong>{slotsAvailable}</strong></div>
      </div>
      <div className="demand-track"><span className={company.demand_ratio > 1 ? "over" : ""} style={{ width: `${Math.min(100, company.demand_ratio * 100)}%` }} /></div>
      <p className="bid-ranking-note">{demandCategory(company.demand_ratio)} · The committee controls bid increases</p>

      {application?.status === "confirmation_required" && (
        <div className="action-required-box">
          <div><Clock3 size={17} /><span><strong>Choose Stay or Withdraw</strong><small>New bid: {company.current_bid} points · <Countdown deadline={application.confirmation_deadline!} /></small></span></div>
          <button onClick={() => setModal("response")}>Respond now</button>
        </div>
      )}
      {application && application.status !== "confirmation_required" && !["withdrawn", "cancelled", "not_selected"].includes(application.status) && (
        <div className="application-inline-status">
          <Check size={15} /> Your application: <strong>{formatStatus(application.status)}</strong> · {application.reserved_points || application.final_points_deducted} pts
        </div>
      )}

      {company.participants && ["open", "paused", "bid_increase_pending", "closed", "finalized"].includes(company.status) && (
        <section className="participant-panel" aria-label={`${company.name} participants`}>
          <div className="participant-panel-head">
            <span><strong>Students currently in session</strong><small>{company.applicant_count} students for {company.cv_requirement} slots</small></span>
            <span className="slots-chip">{slotsAvailable} available</span>
          </div>
          {company.participants.length ? (
            <ul className="participant-list">
              {company.participants.map((participant, index) => (
                <li key={`${participant.full_name}-${index}`}>
                  <span className="participant-avatar" aria-hidden="true">{participant.full_name.charAt(0).toUpperCase()}</span>
                  <span>{participant.full_name}</span>
                  <small className={participant.response_state}>
                    {participantStatusLabel(participant.response_state)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="participant-empty">No students are currently staying in this session.</p>
          )}
        </section>
      )}

      {feedback && !modal && <p className={feedback.ok ? "inline-success" : "inline-error"} role="status">{feedback.message}</p>}
      <div className="company-card-actions">
        <Link href={`/student/companies/${company.slug}`}>View details <ArrowRight size={15} /></Link>
        {canApply && <button className="button button-primary button-small" onClick={() => setModal("apply")}>Apply now</button>}
        {canWithdraw && <button className="button button-danger-ghost button-small" onClick={() => setModal("withdraw")}>Withdraw</button>}
      </div>

      {modal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><X /></button>
            <CompanyAvatar name={company.name} logoUrl={company.logo_url} large />

            {modal === "apply" && (
              <>
                <span className="modal-kicker">CONFIRM APPLICATION</span>
                <h2 id="modal-title">Apply to {company.name}?</h2>
                <p>The committee’s current bid will be reserved immediately. It is spent only if the application is finalized.</p>
                <div className="point-preview">
                  <div><span>Available now</span><strong>{availablePoints} pts</strong></div>
                  <div><span>Current bid</span><strong>− {company.current_bid} pts</strong></div>
                  <div className="point-preview-total"><span>Available after</span><strong>{availablePoints - company.current_bid} pts</strong></div>
                </div>
                {hasInsufficientPoints && <p className="inline-error">You need {company.current_bid} points, but only {availablePoints} are available.</p>}
                <button className="button button-primary modal-primary" disabled={pending || hasInsufficientPoints} onClick={() => run(() => applyToCompany(company.id))}>
                  {pending ? <LoaderCircle className="spin" /> : "Confirm & reserve points"}
                </button>
              </>
            )}

            {modal === "withdraw" && (
              <>
                <span className="modal-kicker">WITHDRAW APPLICATION</span>
                <h2 id="modal-title">Withdraw from {company.name}?</h2>
                <p>No bid increase response is pending, so your {application?.reserved_points} reserved points will be released without a withdrawal charge.</p>
                <button className="button button-danger modal-primary" disabled={pending} onClick={() => run(() => withdrawApplication(application!.id))}>
                  {pending ? <LoaderCircle className="spin" /> : "Withdraw & release reservation"}
                </button>
              </>
            )}

            {modal === "response" && (
              <>
                <span className="modal-kicker">BID INCREASE</span>
                <h2 id="modal-title">Stay or withdraw?</h2>
                <p>Stay by reserving the additional points, or withdraw and pay the base bid plus {application?.bid_response_penalty_percent ?? company.withdrawal_penalty_percent}% of the increase.</p>
                <div className="point-preview">
                  <div><span>Previous bid</span><strong>{application?.accepted_bid} pts</strong></div>
                  <div><span>New bid</span><strong>{company.current_bid} pts</strong></div>
                  <div><span>Additional to stay</span><strong>{additionalPoints} pts</strong></div>
                  <div className="point-preview-total"><span>Charge to withdraw</span><strong>{withdrawal.appliedCharge} pts</strong></div>
                </div>
                {withdrawal.capped && (
                  <p className="target-warning">The calculated charge is {withdrawal.calculatedCharge} points, but it is capped at your usable balance to prevent negative points.</p>
                )}
                {hasInsufficientPoints && <p className="inline-error">You need {additionalPoints} additional points to stay, but only {availablePoints} are available. You can withdraw.</p>}
                <div className="modal-actions-split">
                  <button className="button button-danger-ghost" disabled={pending} onClick={() => run(() => respondToBid(application!.id, false))}>Withdraw · pay {withdrawal.appliedCharge}</button>
                  <button className="button button-primary" disabled={pending || hasInsufficientPoints} onClick={() => run(() => respondToBid(application!.id, true))}>Stay at {company.current_bid}</button>
                </div>
              </>
            )}

            {feedback && <p className={feedback.ok ? "inline-success" : "inline-error"} role="status">{feedback.message}</p>}
          </section>
        </div>
      )}
    </article>
  );
}
