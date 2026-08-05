"use client";

import { useActionState, useEffect, useRef } from "react";
import { Building2, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { createCompany, updateCompany } from "@/app/actions";
import type { ActionState, Company } from "@/lib/types";

const initialState: ActionState = { ok: false, message: "" };
const companyTimeZone = "Asia/Colombo";

function dateTimeInputValue(value: string | null | undefined) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: companyTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function CompanyForm({ company }: { company?: Company }) {
  const editing = Boolean(company);
  const [state, action, pending] = useActionState(
    editing ? updateCompany : createCompany,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && !editing) formRef.current?.reset();
  }, [editing, state.ok]);

  return (
    <form ref={formRef} action={action} className="company-form">
      {company && <input type="hidden" name="companyId" value={company.id} />}
      <div className="form-section-title">
        <span><Building2 /></span>
        <div>
          <h3>{editing ? "Edit company details" : "Company details"}</h3>
          <p>{editing ? "Update the student-facing listing and bidding rules." : "Add an upcoming company to the batch catalogue."}</p>
        </div>
      </div>
      <div className="form-grid two">
        <label>
          Company name
          <input name="name" required defaultValue={company?.name} placeholder="e.g. WSO2" />
        </label>
        <label>
          URL slug
          <input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={company?.slug} placeholder="e.g. wso2" />
        </label>
        <label>
          Industry / domain
          <input name="industry" required defaultValue={company?.industry} placeholder="Enterprise software" />
        </label>
        <label>
          Location
          <input name="location" required defaultValue={company?.location} placeholder="Colombo · Hybrid" />
        </label>
      </div>
      <label>
        Description
        <textarea name="description" rows={3} defaultValue={company?.description ?? ""} placeholder="Short student-facing introduction" />
      </label>
      <div className="form-grid two">
        <label>
          Available roles
          <input name="roles" defaultValue={company?.available_roles.join(", ")} placeholder="Software Engineering, Data Engineering" />
        </label>
        <label>
          Required skills
          <input name="skills" defaultValue={company?.required_skills.join(", ")} placeholder="React, Java, SQL" />
        </label>
      </div>
      <div className="form-section-divider" />
      <div className="form-grid three">
        <label>
          CV requirement
          <input name="cvRequirement" type="number" min="1" required defaultValue={company?.cv_requirement ?? 10} />
        </label>
        <label>
          Minimum bid
          <input
            name="minimumBid"
            type="number"
            min="0"
            max={company && company.status !== "upcoming" ? company.current_bid : undefined}
            required
            defaultValue={company?.minimum_bid ?? 10}
          />
        </label>
        <label>
          Bid increment
          <input name="bidIncrement" type="number" min="1" required defaultValue={company?.bid_increment ?? 5} />
        </label>
        <label>
          Maximum bid
          <input
            name="maximumBid"
            type="number"
            min={company?.current_bid || 1}
            defaultValue={company?.maximum_bid ?? ""}
            placeholder="Optional"
          />
        </label>
        <label>
          Opens at
          <input name="opensAt" type="datetime-local" defaultValue={dateTimeInputValue(company?.opens_at)} />
        </label>
        <label>
          Closes at
          <input name="closesAt" type="datetime-local" defaultValue={dateTimeInputValue(company?.closes_at)} />
        </label>
      </div>
      <p className="form-timezone-note">Schedule times use Sri Lanka time (UTC+05:30).</p>
      {company && company.status !== "upcoming" && (
        <p className="setup-notice">
          This company has already entered the bidding process. Its current bid remains at {company.current_bid} points; use bid controls for increases.
        </p>
      )}
      {state.message && <p className={state.ok ? "inline-success" : "inline-error"}>{state.message}</p>}
      <div className="form-actions">
        {editing && <Link className="button button-ghost" href="/admin/companies">Cancel</Link>}
        <button className="button button-primary" disabled={pending}>
          {pending ? <><LoaderCircle className="spin" /> Saving…</> : editing ? "Save changes" : "Add company"}
        </button>
      </div>
    </form>
  );
}
