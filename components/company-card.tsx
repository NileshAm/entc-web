"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowRight,
  AlertTriangle,
  Check,
  Clock3,
  LoaderCircle,
  MapPin,
  ShieldCheck,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  applyToCompany,
  forceWithdrawExpiredResponse,
  respondToBid,
  submitAutomaticBid,
  withdrawApplication,
} from "@/app/actions";
import { CompanyAvatar } from "@/components/company-avatar";
import { Countdown } from "@/components/countdown";
import { StatusBadge } from "@/components/status-badge";
import { calculateIncreaseWithdrawalCharge } from "@/lib/bidding";
import { demandCategory, formatStatus, participantRankingLabel } from "@/lib/business";
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
  const [modal, setModal] = useState<"apply" | "bid" | "withdraw" | "response" | null>(null);
  const [feedback, setFeedback] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const timeoutHandled = useRef<string | null>(null);
  const application = company.application;
  const isAutomatic = company.bidding_mode === "automatic";
  const hasActiveApplication = Boolean(
    application && ["active_bid", "confirmed"].includes(application.status),
  );
  const minimumAutomaticBid = hasActiveApplication
    ? (application?.accepted_bid ?? 0) + 1
    : company.minimum_bid;
  const maximumAffordableBid = (application?.reserved_points ?? 0) + availablePoints;
  const initialAutomaticBid = Math.min(
    Math.max(minimumAutomaticBid, company.current_bid),
    company.maximum_bid === null
      ? maximumAffordableBid
      : Math.min(maximumAffordableBid, company.maximum_bid),
  );
  const [automaticBid, setAutomaticBid] = useState(initialAutomaticBid);
  const automaticAdditional = Math.max(
    0,
    automaticBid - (application?.reserved_points ?? 0),
  );
  const invalidAutomaticBid = !Number.isInteger(automaticBid)
    || automaticBid < minimumAutomaticBid
    || automaticBid > maximumAffordableBid
    || (company.maximum_bid !== null && automaticBid > company.maximum_bid);
  const selfParticipant = company.participants?.find((participant) => participant.is_self);

  useEffect(() => {
    if (isAutomatic
      || application?.status !== "confirmation_required"
      || !application.confirmation_deadline) return;

    const timeoutKey = `${application.id}:${application.confirmation_deadline}`;
    const settleExpiredResponse = () => {
      if (timeoutHandled.current === timeoutKey) return;
      timeoutHandled.current = timeoutKey;
      startTransition(async () => {
        const result = await forceWithdrawExpiredResponse(application.id);
        if (result.ok) {
          router.replace("/student?forcedWithdrawal=1");
        } else {
          router.refresh();
        }
      });
    };
    const delay = Math.max(
      0,
      new Date(application.confirmation_deadline).getTime() - Date.now(),
    );
    const timer = window.setTimeout(settleExpiredResponse, delay);
    return () => window.clearTimeout(timer);
  }, [application, isAutomatic, router]);

  const additionalPoints = Math.max(
    0,
    company.current_bid - (application?.reserved_points ?? 0),
  );
  const withdrawal = calculateIncreaseWithdrawalCharge({
    initialBid: application?.initial_bid ?? 0,
    currentBid: isAutomatic
      ? (application?.accepted_bid ?? 0)
      : company.current_bid,
    penaltyPercent: application?.bid_response_penalty_percent
      ?? company.withdrawal_penalty_percent,
    availablePoints,
    reservedPoints: application?.reserved_points ?? 0,
  });
  const hasInsufficientPoints = availablePoints < (
    application?.status === "confirmation_required"
      ? additionalPoints
      : company.current_bid
  );
  const slotsAvailable = Math.max(0, company.cv_requirement - company.applicant_count);
  const hasActiveRanking = Boolean(
    selfParticipant
      && application
      && ["active_bid", "confirmed", "confirmation_required"].includes(application.status)
      && ["open", "paused", "bid_increase_pending"].includes(company.status),
  );
  const isEliminationRisk = hasActiveRanking && !selfParticipant?.is_currently_selected;
  const isSafe = hasActiveRanking && selfParticipant?.is_currently_selected;
  const automaticWithdrawalIsFinal = isAutomatic && application?.status === "withdrawn";

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

  function openAutomaticBid() {
    setAutomaticBid(initialAutomaticBid);
    setFeedback(null);
    setModal("bid");
  }

  const canApply = !isAutomatic && company.status === "open" && (
    !application || ["withdrawn", "cancelled", "not_selected"].includes(application.status)
  );
  const canAutomaticBid = isAutomatic && company.status === "open" && (
    !application || ["active_bid", "confirmed", "cancelled", "not_selected"].includes(application.status)
  );
  const canWithdraw = application
    && ["active_bid", "confirmed"].includes(application.status)
    && (isAutomatic
      ? company.status === "open"
      : !["finalized", "cancelled"].includes(company.status));

  return (
    <article className={`company-card ${featured ? "featured" : ""} ${isEliminationRisk ? "cutoff-danger" : isSafe ? "cutoff-safe" : ""}`}>
      <div className="company-card-head">
        <CompanyAvatar name={company.name} logoUrl={company.logo_url} />
        <div className="company-title"><h3>{company.name}</h3><span>{company.industry}</span></div>
        <StatusBadge status={company.status} />
      </div>
      <div className="company-meta">
        <span><MapPin size={15} /> {company.location}</span>
        <span><Users size={15} /> {company.applicant_count} bidding · {company.cv_requirement} slots</span>
      </div>
      <div className="company-tags">
        {company.available_roles.slice(0, 2).map((role) => <span key={role}>{role}</span>)}
      </div>
      <div className="company-bid-row">
        <div><small>{isAutomatic ? "HIGHEST BID" : "CURRENT BID"}</small><strong>{company.current_bid} <span>pts</span></strong></div>
        <div><small>{isAutomatic ? "SELECTED POSITIONS" : "SLOTS AVAILABLE"}</small><strong>{isAutomatic ? company.cv_requirement : slotsAvailable}</strong></div>
      </div>
      <div className="demand-track"><span className={company.demand_ratio > 1 ? "over" : ""} style={{ width: `${Math.min(100, company.demand_ratio * 100)}%` }} /></div>
      <p className="bid-ranking-note">
        {isAutomatic
          ? <>Automatic ranked bidding · Top {company.cv_requirement} bids win</>
          : <>{demandCategory(company.demand_ratio)} · The committee controls bid increases</>}
      </p>

      {isEliminationRisk && (
        <div className="cutoff-alert danger" role="alert">
          <AlertTriangle />
          <span><strong>You are about to be eliminated</strong><small>Your rank is outside the {company.cv_requirement} available slots. {isAutomatic ? "Increase your bid before the session ends" : "Respond to any pending bid increase before its timer ends"} to avoid a charged force withdrawal.</small></span>
        </div>
      )}
      {isSafe && (
        <div className="cutoff-alert safe" role="status">
          <ShieldCheck />
          <span><strong>You are currently safe</strong><small>Your rank is within the {company.cv_requirement} available slots. Keep watching in case another bid changes the cutoff.</small></span>
        </div>
      )}

      {isAutomatic && company.status === "open" && company.auto_closes_at && (
        <div className="auto-bid-timer">
          <Clock3 size={17} />
          <span><strong>Closes after bidding inactivity</strong><small>Time remaining: <Countdown deadline={company.auto_closes_at} /></small></span>
        </div>
      )}

      {!isAutomatic && application?.status === "confirmation_required" && (
        <div className="action-required-box">
          <div><Clock3 size={17} /><span><strong>Choose Stay or Withdraw</strong><small>New bid: {company.current_bid} points · <Countdown deadline={application.confirmation_deadline!} /></small></span></div>
          <button onClick={() => setModal("response")}>Respond now</button>
        </div>
      )}
      {application && application.status !== "confirmation_required" && !["withdrawn", "cancelled", "not_selected"].includes(application.status) && (
        <div className={`application-inline-status ${isEliminationRisk ? "danger" : isSafe ? "safe" : ""}`}>
          {isAutomatic ? <Trophy size={15} /> : <Check size={15} />}
          {isAutomatic ? (
            <>Your bid: <strong>{application.accepted_bid} pts</strong>{selfParticipant?.rank_position ? ` · Rank #${selfParticipant.rank_position}` : ""}{selfParticipant ? ` · ${selfParticipant.is_currently_selected ? "Inside top slots" : "Outside cutoff"}` : ""}</>
          ) : (
            <>Your application: <strong>{formatStatus(application.status)}</strong> · {application.reserved_points || application.final_points_deducted} pts</>
          )}
        </div>
      )}
      {automaticWithdrawalIsFinal && (
        <div className="automatic-withdrawal-final" role="status">
          <AlertTriangle />
          <span><strong>Withdrawal is final</strong><small>Your withdrawal charge was deducted. You cannot place another bid for this company.</small></span>
        </div>
      )}

      {company.participants && ["open", "paused", "bid_increase_pending", "closed", "finalized"].includes(company.status) && (
        <section className="participant-panel" aria-label={`${company.name} participants`}>
          <div className="participant-panel-head">
            <span><strong>Applicant ranking</strong><small>{company.participants.length} applicants · {company.cv_requirement} slots</small></span>
            <span className="slots-chip">{isAutomatic ? `Top ${company.cv_requirement}` : `${slotsAvailable} available`}</span>
          </div>
          {company.participants.length ? (
            <ul className="participant-list">
              {company.participants.map((participant, index) => (
                <li key={`${participant.full_name}-${index}`} className={participant.is_self ? `self ${["withdrawn", "not_selected"].includes(participant.response_state) ? "inactive" : participant.is_currently_selected ? "safe" : "at-risk"}` : ""}>
                  <span className="participant-avatar" aria-hidden="true">{participant.full_name.charAt(0).toUpperCase()}</span>
                  <span>{participant.full_name}{participant.is_self ? " (You)" : ""}</span>
                  <small className={["withdrawn", "not_selected", "selected", "finalized"].includes(participant.response_state) ? participant.response_state : participant.is_currently_selected ? participant.response_state : "pending"}>
                    {participantRankingLabel(participant, company.bidding_mode, company.cv_requirement)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="participant-empty">No applications have been submitted.</p>
          )}
        </section>
      )}

      {feedback && !modal && <p className={feedback.ok ? "inline-success" : "inline-error"} role="status">{feedback.message}</p>}
      <div className="company-card-actions">
        <Link href={`/student/companies/${company.slug}`}>View details <ArrowRight size={15} /></Link>
        {canApply && <button className="button button-primary button-small" onClick={() => setModal("apply")}>Apply now</button>}
        {canAutomaticBid && <button className="button button-primary button-small" onClick={openAutomaticBid}>{hasActiveApplication ? "Increase bid" : "Place bid"}</button>}
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

            {modal === "bid" && (
              <>
                <span className="modal-kicker">AUTOMATIC RANKED BID</span>
                <h2 id="modal-title">{hasActiveApplication ? "Increase your bid" : "Place your bid"} for {company.name}</h2>
                <p>The top {company.cv_requirement} bids are selected when nobody submits a bid for {company.inactivity_timeout_seconds} seconds. Equal bids favor the earlier submission. Bids outside the cutoff are force-withdrawn under the normal withdrawal rules.</p>
                <label className="field-label">
                  Your bid
                  <input
                    type="number"
                    inputMode="numeric"
                    min={minimumAutomaticBid}
                    max={company.maximum_bid === null
                      ? maximumAffordableBid
                      : Math.min(company.maximum_bid, maximumAffordableBid)}
                    step="1"
                    value={automaticBid}
                    onChange={(event) => setAutomaticBid(Number(event.target.value))}
                    required
                  />
                </label>
                <div className="point-preview">
                  <div><span>Available now</span><strong>{availablePoints} pts</strong></div>
                  <div><span>Current reservation</span><strong>{application?.reserved_points ?? 0} pts</strong></div>
                  <div><span>Additional reserve</span><strong>− {Number.isFinite(automaticAdditional) ? automaticAdditional : 0} pts</strong></div>
                  <div className="point-preview-total"><span>Available after</span><strong>{availablePoints - (Number.isFinite(automaticAdditional) ? automaticAdditional : 0)} pts</strong></div>
                </div>
                <p className="target-warning">Withdrawing later charges your first bid plus {company.withdrawal_penalty_percent}% of your own bid increase.</p>
                {invalidAutomaticBid && <p className="inline-error">Enter a whole-number bid from {minimumAutomaticBid} to {company.maximum_bid === null ? maximumAffordableBid : Math.min(maximumAffordableBid, company.maximum_bid)} points.</p>}
                <button className="button button-primary modal-primary" disabled={pending || invalidAutomaticBid} onClick={() => run(() => submitAutomaticBid(company.id, automaticBid))}>
                  {pending ? <LoaderCircle className="spin" /> : `Submit ${automaticBid} point bid`}
                </button>
              </>
            )}

            {modal === "withdraw" && (
              <>
                <span className="modal-kicker">WITHDRAW APPLICATION</span>
                <h2 id="modal-title">Withdraw from {company.name}?</h2>
                {isAutomatic ? (
                  <>
                    <p>Automatic-bid withdrawals charge your first bid plus {company.withdrawal_penalty_percent}% of the amount you increased it.</p>
                    <div className="point-preview">
                      <div><span>First bid</span><strong>{application?.initial_bid} pts</strong></div>
                      <div><span>Current bid</span><strong>{application?.accepted_bid} pts</strong></div>
                      <div className="point-preview-total"><span>Withdrawal charge</span><strong>{withdrawal.appliedCharge} pts</strong></div>
                    </div>
                  </>
                ) : (
                  <p>No bid increase response is pending, so your {application?.reserved_points} reserved points will be released without a withdrawal charge.</p>
                )}
                <button className="button button-danger modal-primary" disabled={pending} onClick={() => run(() => withdrawApplication(application!.id))}>
                  {pending ? <LoaderCircle className="spin" /> : isAutomatic ? `Withdraw & pay ${withdrawal.appliedCharge}` : "Withdraw & release reservation"}
                </button>
              </>
            )}

            {modal === "response" && (
              <>
                <span className="modal-kicker">BID INCREASE</span>
                <h2 id="modal-title">Stay or withdraw?</h2>
                <p>Stay by reserving the additional points, or withdraw and pay the base bid plus {application?.bid_response_penalty_percent ?? company.withdrawal_penalty_percent}% of the increase. If you do not respond before the timer expires, you will be force-withdrawn and the same charge will be deducted from your account.</p>
                <div className="point-preview">
                  <div><span>Previous bid</span><strong>{application?.accepted_bid} pts</strong></div>
                  <div><span>New bid</span><strong>{company.current_bid} pts</strong></div>
                  <div><span>Additional to stay</span><strong>{additionalPoints} pts</strong></div>
                  <div className="point-preview-total"><span>Charge to withdraw</span><strong>{withdrawal.appliedCharge} pts</strong></div>
                </div>
                {withdrawal.capped && <p className="target-warning">The calculated charge is {withdrawal.calculatedCharge} points, but it is capped at your usable balance to prevent negative points.</p>}
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
