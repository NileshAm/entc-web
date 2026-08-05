"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowRight, Check, Clock3, LoaderCircle, MapPin, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { applyToCompany, respondToBid, withdrawApplication } from "@/app/actions";
import { CompanyAvatar } from "@/components/company-avatar";
import { Countdown } from "@/components/countdown";
import { StatusBadge } from "@/components/status-badge";
import { demandCategory, formatStatus } from "@/lib/business";
import type { ActionState, Company } from "@/lib/types";

export function CompanyCard({ company, availablePoints, featured = false }: { company: Company; availablePoints: number; featured?: boolean }) {
  const router = useRouter();
  const [modal, setModal] = useState<"apply" | "withdraw" | "bid" | null>(null);
  const [feedback, setFeedback] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const application = company.application;
  const additionalPoints = Math.max(0, company.current_bid - (application?.reserved_points ?? 0));
  const hasInsufficientPoints = availablePoints < (application?.status === "confirmation_required" ? additionalPoints : company.current_bid);

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

  const canApply = company.status === "open" && (!application || ["withdrawn", "cancelled", "not_selected"].includes(application.status));
  const canWithdraw = application && ["active_bid", "confirmed"].includes(application.status) && company.status !== "finalized";

  return (
    <article className={`company-card ${featured ? "featured" : ""}`}>
      <div className="company-card-head">
        <CompanyAvatar name={company.name} logoUrl={company.logo_url} />
        <div className="company-title"><h3>{company.name}</h3><span>{company.industry}</span></div>
        <StatusBadge status={company.status} />
      </div>
      <div className="company-meta">
        <span><MapPin size={15} /> {company.location}</span>
        <span><Users size={15} /> {company.applicant_count} applicants · {company.cv_requirement} CVs</span>
      </div>
      <div className="company-tags">
        {company.available_roles.slice(0, 2).map((role) => <span key={role}>{role}</span>)}
      </div>
      <div className="company-bid-row">
        <div><small>CURRENT BID</small><strong>{company.current_bid} <span>pts</span></strong></div>
        <div><small>DEMAND</small><strong className={company.demand_ratio > 1 ? "danger-text" : ""}>{demandCategory(company.demand_ratio)}</strong></div>
      </div>
      <div className="demand-track"><span className={company.demand_ratio > 1 ? "over" : ""} style={{ width: `${Math.min(100, company.demand_ratio * 100)}%` }} /></div>

      {application?.status === "confirmation_required" && (
        <div className="action-required-box">
          <div><Clock3 size={17} /><span><strong>Bid response required</strong><small>New bid: {company.current_bid} points · <Countdown deadline={application.confirmation_deadline!} /></small></span></div>
          <button onClick={() => setModal("bid")}>Respond now</button>
        </div>
      )}
      {application && application.status !== "confirmation_required" && !["withdrawn", "cancelled", "not_selected"].includes(application.status) && (
        <div className="application-inline-status">
          <Check size={15} /> Your application: <strong>{formatStatus(application.status)}</strong> · {application.reserved_points || application.final_points_deducted} pts
        </div>
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
            {modal === "apply" && <>
              <span className="modal-kicker">CONFIRM APPLICATION</span>
              <h2 id="modal-title">Apply to {company.name}?</h2>
              <p>The current bid will be reserved immediately. It is only spent if this application is finalized.</p>
              <div className="point-preview">
                <div><span>Available now</span><strong>{availablePoints} pts</strong></div>
                <div><span>Points to reserve</span><strong>− {company.current_bid} pts</strong></div>
                <div className="point-preview-total"><span>Available after</span><strong>{availablePoints - company.current_bid} pts</strong></div>
              </div>
              {hasInsufficientPoints && <p className="inline-error">You need {company.current_bid} points, but only {availablePoints} are available.</p>}
              <button className="button button-primary modal-primary" disabled={pending || hasInsufficientPoints} onClick={() => run(() => applyToCompany(company.id))}>
                {pending ? <LoaderCircle className="spin" /> : "Confirm & reserve points"}
              </button>
            </>}
            {modal === "withdraw" && <>
              <span className="modal-kicker">RELEASE RESERVATION</span>
              <h2 id="modal-title">Withdraw from {company.name}?</h2>
              <p>Your application will be withdrawn and {application?.reserved_points} reserved points will return to your available balance.</p>
              <button className="button button-danger modal-primary" disabled={pending} onClick={() => run(() => withdrawApplication(application!.id))}>
                {pending ? <LoaderCircle className="spin" /> : "Yes, withdraw application"}
              </button>
            </>}
            {modal === "bid" && <>
              <span className="modal-kicker">BID INCREASE</span>
              <h2 id="modal-title">Respond to the new bid</h2>
              <p>Keep your place by reserving the additional points, or withdraw and release the existing reservation.</p>
              <div className="point-preview">
                <div><span>Previous bid</span><strong>{application?.accepted_bid} pts</strong></div>
                <div><span>New bid</span><strong>{company.current_bid} pts</strong></div>
                <div className="point-preview-total"><span>Additional points</span><strong>{additionalPoints} pts</strong></div>
              </div>
              {hasInsufficientPoints && <p className="inline-error">You need {additionalPoints} additional points, but only {availablePoints} are available. You must withdraw.</p>}
              <div className="modal-actions-split">
                <button className="button button-danger-ghost" disabled={pending} onClick={() => run(() => respondToBid(application!.id, false))}>Withdraw</button>
                <button className="button button-primary" disabled={pending || hasInsufficientPoints} onClick={() => run(() => respondToBid(application!.id, true))}>Accept new bid</button>
              </div>
            </>}
            {feedback && <p className={feedback.ok ? "inline-success" : "inline-error"} role="status">{feedback.message}</p>}
          </section>
        </div>
      )}
    </article>
  );
}
