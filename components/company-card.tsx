"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowRight,
  AlertTriangle,
  Check,
  Clock3,
  LoaderCircle,
  LockKeyhole,
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
  placeAutomaticRegistrationBid,
  respondToBid,
  submitAutomaticBid,
  withdrawApplication,
} from "@/app/actions";
import { CompanyAvatar } from "@/components/company-avatar";
import { Countdown } from "@/components/countdown";
import { StatusBadge } from "@/components/status-badge";
import {
  canJoinCompany,
  canPlaceAutomaticRegistrationBid,
  canSubmitAutomaticBid,
  calculateIncreaseWithdrawalCharge,
  withdrawalPenaltyApplies,
} from "@/lib/bidding";
import { demandCategory, formatStatus, participantRankingLabel } from "@/lib/business";
import type { ActionState, Company } from "@/lib/types";

export function CompanyCard({
  company,
  availablePoints,
  featured = false,
  showRoundResults = false,
}: {
  company: Company;
  availablePoints: number;
  featured?: boolean;
  showRoundResults?: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<"apply" | "bid" | "withdraw" | "response" | null>(null);
  const [feedback, setFeedback] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const timeoutHandled = useRef<string | null>(null);
  const application = company.application;
  const isAutomatic = company.bidding_mode === "automatic";
  const isRegistrationOpen = company.status === "registration_open";
  const hasActiveApplication = Boolean(
    application && ["active_bid", "confirmed"].includes(application.status),
  );
  const minimumAutomaticBid = isRegistrationOpen
    ? company.minimum_bid
    : hasActiveApplication
    ? (application?.accepted_bid ?? 0) + 1
    : company.minimum_bid;
  const maximumAffordableBid = (application?.reserved_points ?? 0) + availablePoints;
  const preferredAutomaticBid = isRegistrationOpen && hasActiveApplication
    ? application?.accepted_bid ?? company.minimum_bid
    : Math.max(minimumAutomaticBid, company.current_bid);
  const initialAutomaticBid = Math.min(
    preferredAutomaticBid,
    company.maximum_bid === null
      ? maximumAffordableBid
      : Math.min(maximumAffordableBid, company.maximum_bid),
  );
  const [automaticBid, setAutomaticBid] = useState(initialAutomaticBid);
  const automaticReservationChange = automaticBid
    - (application?.reserved_points ?? 0);
  const invalidAutomaticBid = !Number.isInteger(automaticBid)
    || automaticBid < minimumAutomaticBid
    || automaticBid > maximumAffordableBid
    || (company.maximum_bid !== null && automaticBid > company.maximum_bid);
  const selfParticipant = company.participants?.find((participant) => participant.is_self);

  useEffect(() => {
    if (isAutomatic
      || showRoundResults
      || !application?.confirmation_deadline
      || !["confirmation_required", "confirmed"].includes(application.status)) return;

    const timeoutKey = `${application.id}:${application.confirmation_deadline}`;
    const showResultsWhenTimerEnds = () => {
      if (timeoutHandled.current === timeoutKey) return;
      timeoutHandled.current = timeoutKey;
      startTransition(async () => {
        if (application.status === "confirmation_required") {
          await forceWithdrawExpiredResponse(application.id);
        }
        router.replace(`/student/companies/${company.slug}?roundResults=1&timerExpired=1`);
      });
    };
    const delay = Math.max(
      0,
      new Date(application.confirmation_deadline).getTime() - Date.now(),
    );
    const timer = window.setTimeout(showResultsWhenTimerEnds, delay);
    return () => window.clearTimeout(timer);
  }, [application, company.slug, isAutomatic, router, showRoundResults]);

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
    isAutomatic
      && selfParticipant
      && application
      && ["active_bid", "confirmed", "confirmation_required"].includes(application.status)
      && ["open", "paused", "bid_increase_pending"].includes(company.status),
  );
  const isEliminationRisk = hasActiveRanking && !selfParticipant?.is_currently_selected;
  const isSafe = hasActiveRanking && selfParticipant?.is_currently_selected;
  const withdrawalCarriesPenalty = withdrawalPenaltyApplies(
    application?.status,
    company.status,
  );
  const withdrawalCostNow = withdrawalCarriesPenalty
    ? withdrawal.appliedCharge
    : 0;
  const showWithdrawalImpact = Boolean(
    application && ["active_bid", "confirmed", "confirmation_required"].includes(application.status),
  );
  const inactiveApplication = Boolean(
    application && ["withdrawn", "not_selected", "cancelled"].includes(application.status),
  );
  const hasPendingManualDecision = !isAutomatic
    && application?.status === "confirmation_required";
  const activeParticipantCount = company.participants?.filter((participant) =>
    ["staying", "pending"].includes(participant.response_state)
  ).length ?? company.applicant_count;

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

  const canJoin = canJoinCompany(company.status, application?.status);
  const canPlaceRegistrationBid = isAutomatic
    && canPlaceAutomaticRegistrationBid(company.status, application?.status);
  const canAutomaticBid = isAutomatic
    && canSubmitAutomaticBid(company.status, application?.status);
  const canWithdraw = application
    && ["active_bid", "confirmed", "confirmation_required"].includes(application.status)
    && (isRegistrationOpen || (isAutomatic
      ? company.status === "open"
      : !["upcoming", "finalized", "cancelled"].includes(company.status)));
  const isActiveSession = [
    "open",
    "paused",
    "bid_increase_pending",
  ].includes(company.status);
  const isEligibleParticipant = application
    && ["active_bid", "confirmed", "confirmation_required"].includes(application.status);
  const sessionLockedForStudent = isActiveSession && !isEligibleParticipant;

  return (
    <article className={`company-card ${featured ? "featured" : ""} ${isEliminationRisk ? "cutoff-danger" : isSafe ? "cutoff-safe" : ""}`}>
      <div className="company-card-head">
        <CompanyAvatar name={company.name} logoUrl={company.logo_url} />
        <div className="company-title"><h3>{company.name}</h3><span>{company.industry}</span></div>
        <StatusBadge status={company.status} />
      </div>
      <div className="company-meta">
        <span><MapPin size={15} /> {company.location}</span>
        <span><Users size={15} /> {company.applicant_count} {isRegistrationOpen ? (isAutomatic ? "pre-bids" : "joined") : "bidding"} · {company.cv_requirement} slots</span>
      </div>
      <div className="company-tags">
        {company.available_roles.slice(0, 2).map((role) => <span key={role}>{role}</span>)}
      </div>
      <div className={`company-bid-row ${showWithdrawalImpact ? "with-withdrawal" : ""}`}>
        <div><small>{isAutomatic ? (isRegistrationOpen ? "HIGHEST PRE-BID" : "HIGHEST BID") : "CURRENT BID"}</small><strong>{company.current_bid} <span>pts</span></strong></div>
        <div><small>{isAutomatic ? "SELECTED POSITIONS" : "SLOTS AVAILABLE"}</small><strong>{isAutomatic ? company.cv_requirement : slotsAvailable}</strong></div>
        {showWithdrawalImpact && (
          <div className={`withdrawal-impact ${withdrawalCostNow > 0 ? "cost" : "free"}`}>
            <small>LOSE IF YOU WITHDRAW NOW</small>
            <strong>{withdrawalCostNow} <span>pts</span></strong>
          </div>
        )}
      </div>
      <div className="demand-track"><span className={company.demand_ratio > 1 ? "over" : ""} style={{ width: `${Math.min(100, company.demand_ratio * 100)}%` }} /></div>
      <p className="bid-ranking-note">
        {isRegistrationOpen
          ? <>{isAutomatic ? "Registration is open · Place your initial bid" : "Registration is open · Join before bidding starts"}</>
          : isAutomatic
          ? <>Automatic ranked bidding · Top {company.cv_requirement} bids win</>
          : <>{demandCategory(company.demand_ratio)} · The committee controls bid increases</>}
      </p>

      {sessionLockedForStudent && (
        <div className="cutoff-alert locked" role="status">
          <LockKeyhole />
          <span><strong>Session membership is locked</strong><small>Bidding has started. Only students who joined during registration can participate in this company session.</small></span>
        </div>
      )}

      {isEliminationRisk && (
        <div className="cutoff-alert danger" role="alert">
          <AlertTriangle />
          <span><strong>You are about to be eliminated</strong><small>Your rank is outside the {company.cv_requirement} available slots. Increase your bid before the automatic session ends to avoid a charged force withdrawal.</small></span>
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
        <div className="action-required-box" role="alert">
          <div className="action-required-copy">
            <span className="action-required-icon"><Clock3 /></span>
            <span><strong>Action required: stay or withdraw</strong><small>Stay needs {additionalPoints} more points. Withdrawing now costs {withdrawal.appliedCharge} points.</small></span>
          </div>
          <div className="decision-timer"><small>RESPOND WITHIN</small><strong><Countdown deadline={application.confirmation_deadline!} /></strong></div>
          <button className="button button-warning" onClick={() => setModal("response")}>Review choices</button>
        </div>
      )}
      {application && application.status !== "confirmation_required" && (
        <div className={`application-inline-status ${inactiveApplication ? "inactive" : isEliminationRisk ? "danger" : isSafe ? "safe" : ""}`}>
          {inactiveApplication ? <AlertTriangle size={17} /> : isAutomatic ? <Trophy size={17} /> : <Check size={17} />}
          <span>
            <small>YOUR STATUS</small>
            {inactiveApplication ? (
              <><strong>{formatStatus(application.status)}</strong>{application.status === "withdrawn" ? ` · ${application.withdrawal_charge} pts charged` : " · This bid is no longer active"}</>
            ) : isRegistrationOpen ? (
              <><strong>{isAutomatic ? `${application.accepted_bid} point bid registered` : "Registered"}</strong> · {application.reserved_points} pts reserved · Free withdrawal before bidding starts</>
            ) : isAutomatic ? (
              <><strong>{application.accepted_bid} pts bid</strong>{selfParticipant?.rank_position ? ` · Rank #${selfParticipant.rank_position}` : ""}{selfParticipant ? ` · ${selfParticipant.is_currently_selected ? "Inside top slots" : "Outside cutoff"}` : ""}</>
            ) : (
              <><strong>{formatStatus(application.status)}</strong> · {application.reserved_points || application.final_points_deducted} pts</>
            )}
          </span>
        </div>
      )}

      {company.participants && ["registration_open", "open", "paused", "bid_increase_pending", "closed", "finalized"].includes(company.status) && (
        <section className="participant-panel" aria-label={`${company.name} participants`}>
          <div className="participant-panel-head">
            <span><strong>{isRegistrationOpen ? "Pre-bidding registered cohort" : isAutomatic ? "Applicant ranking and outcomes" : "Committee bidding participants"}</strong><small>{activeParticipantCount} active · {company.participants.length} total records · {company.cv_requirement} required</small></span>
            <span className="slots-chip">{isRegistrationOpen ? "Cohort forming" : isAutomatic ? `Top ${company.cv_requirement}` : `Target ${company.cv_requirement}`}</span>
          </div>
          {company.participants.length ? (
            <ul className="participant-list">
              {company.participants.map((participant, index) => (
                <li key={`${participant.full_name}-${index}`} className={participant.is_self ? `self ${["withdrawn", "not_selected"].includes(participant.response_state) ? "inactive" : isAutomatic ? participant.is_currently_selected ? "safe" : "at-risk" : ""}` : ""}>
                  <span className="participant-avatar" aria-hidden="true">{participant.full_name.charAt(0).toUpperCase()}</span>
                  <span>{participant.full_name}{participant.is_self ? " (You)" : ""}</span>
                  <small className={["withdrawn", "not_selected", "selected", "finalized"].includes(participant.response_state) ? participant.response_state : !isAutomatic || participant.is_currently_selected ? participant.response_state : "pending"}>
                    {isRegistrationOpen && participant.response_state !== "withdrawn"
                      ? `${participant.bid_amount} pts reserved · ${isAutomatic ? "Initial bid" : "Registered"}`
                      : participantRankingLabel(participant, company.bidding_mode)}
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
        <Link className="button button-ghost button-small details-action" href={`/student/companies/${company.slug}`}>View details <ArrowRight size={16} /></Link>
        <div className="company-bid-actions">
          {!isAutomatic && canJoin && <button className="button button-primary button-small" onClick={() => setModal("apply")}>Join at {company.current_bid} pts</button>}
          {canPlaceRegistrationBid && <button className="button button-primary button-small" onClick={openAutomaticBid}>{hasActiveApplication ? "Update bid" : "Place bid"}</button>}
          {canAutomaticBid && <button className="button button-primary button-small" onClick={openAutomaticBid}>Increase bid</button>}
          {canWithdraw && <button className="button button-danger-ghost button-small" onClick={() => setModal("withdraw")}>Withdraw · {withdrawalCostNow} pts</button>}
        </div>
      </div>

      {modal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><X /></button>
            <CompanyAvatar name={company.name} logoUrl={company.logo_url} large />

            {modal === "apply" && (
              <>
                <span className="modal-kicker">PRE-BIDDING REGISTRATION</span>
                <h2 id="modal-title">Join {company.name}?</h2>
                <p>The opening bid will be reserved now to secure your place in the bidding cohort. You can leave and recover every reserved point until bidding starts; after that, normal withdrawal deductions apply.</p>
                <div className="point-preview">
                  <div><span>Available now</span><strong>{availablePoints} pts</strong></div>
                  <div><span>Current bid</span><strong>− {company.current_bid} pts</strong></div>
                  <div className="point-preview-total"><span>Available after</span><strong>{availablePoints - company.current_bid} pts</strong></div>
                </div>
                {hasInsufficientPoints && <p className="inline-error">You need {company.current_bid} points, but only {availablePoints} are available.</p>}
                <button className="button button-primary modal-primary" disabled={pending || hasInsufficientPoints} onClick={() => run(() => applyToCompany(company.id))}>
                  {pending ? <LoaderCircle className="spin" /> : "Join & reserve opening bid"}
                </button>
              </>
            )}

            {modal === "bid" && (
              <>
                <span className="modal-kicker">{isRegistrationOpen ? "PRE-BIDDING REGISTRATION" : "AUTOMATIC RANKED BID"}</span>
                <h2 id="modal-title">{isRegistrationOpen && hasActiveApplication ? "Update your registration bid" : hasActiveApplication ? "Increase your bid" : "Place your bid"} for {company.name}</h2>
                <p>{isRegistrationOpen
                  ? `Choose your initial bid to register for one of ${company.cv_requirement} slots. It will be reserved now, but the live inactivity timer will start only when the administrator activates bidding.`
                  : `The top ${company.cv_requirement} bids are selected when nobody submits a bid for ${company.inactivity_timeout_seconds} seconds. Equal bids favor the earlier submission. Bids outside the cutoff are force-withdrawn under the normal withdrawal rules.`}</p>
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
                  <div><span>{automaticReservationChange < 0 ? "Reservation released" : "Additional reserve"}</span><strong>{automaticReservationChange < 0 ? "+" : "−"} {Number.isFinite(automaticReservationChange) ? Math.abs(automaticReservationChange) : 0} pts</strong></div>
                  <div className="point-preview-total"><span>Available after</span><strong>{availablePoints - (Number.isFinite(automaticReservationChange) ? automaticReservationChange : 0)} pts</strong></div>
                </div>
                <p className="target-warning">{isRegistrationOpen
                  ? `Withdrawal is free before bidding starts. After activation, withdrawing charges this first bid plus ${company.withdrawal_penalty_percent}% of later increases.`
                  : `Withdrawing charges your first bid plus ${company.withdrawal_penalty_percent}% of your own bid increase.`}</p>
                {invalidAutomaticBid && <p className="inline-error">Enter a whole-number bid from {minimumAutomaticBid} to {company.maximum_bid === null ? maximumAffordableBid : Math.min(maximumAffordableBid, company.maximum_bid)} points.</p>}
                <button className="button button-primary modal-primary" disabled={pending || invalidAutomaticBid} onClick={() => run(() => isRegistrationOpen
                  ? placeAutomaticRegistrationBid(company.id, automaticBid)
                  : submitAutomaticBid(company.id, automaticBid))}>
                  {pending ? <LoaderCircle className="spin" /> : isRegistrationOpen ? `${hasActiveApplication ? "Update" : "Register"} ${automaticBid} point bid` : `Submit ${automaticBid} point bid`}
                </button>
              </>
            )}

            {modal === "withdraw" && (
              <>
                <span className="modal-kicker">WITHDRAW APPLICATION</span>
                <h2 id="modal-title">Withdraw from {company.name}?</h2>
                {withdrawalCarriesPenalty ? (
                  <>
                    <p>{isAutomatic
                      ? `Automatic-bid withdrawals charge your first bid plus ${company.withdrawal_penalty_percent}% of the amount you increased it.`
                      : hasPendingManualDecision
                        ? `A bid decision is pending. Self-withdrawal has the same charge as choosing Withdraw: your first bid plus ${application?.bid_response_penalty_percent ?? company.withdrawal_penalty_percent}% of the bid increase.`
                        : `Manual self-withdrawal charges your first bid plus ${company.withdrawal_penalty_percent}% of any bid increase.`}</p>
                    <div className="point-preview">
                      <div><span>First bid</span><strong>{application?.initial_bid} pts</strong></div>
                      <div><span>{isAutomatic ? "Your current bid" : "New company bid"}</span><strong>{isAutomatic ? application?.accepted_bid : company.current_bid} pts</strong></div>
                      <div className="point-preview-total"><span>Withdrawal charge</span><strong>{withdrawal.appliedCharge} pts</strong></div>
                    </div>
                  </>
                ) : (
                  <p>Bidding has not started, so all {application?.reserved_points} reserved points will be released and no withdrawal charge will be deducted.</p>
                )}
                <button className="button button-danger modal-primary" disabled={pending} onClick={() => run(() => withdrawApplication(application!.id))}>
                  {pending ? <LoaderCircle className="spin" /> : withdrawalCarriesPenalty ? `Withdraw & pay ${withdrawal.appliedCharge} pts` : "Withdraw & release reservation"}
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
