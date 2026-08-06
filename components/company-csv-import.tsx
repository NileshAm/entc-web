"use client";

import { useActionState, useRef, useState } from "react";
import { Building2, Download, LoaderCircle, Upload } from "lucide-react";
import { importCompanies } from "@/app/actions";
import type { ActionState } from "@/lib/types";

const initialState: ActionState = { ok: false, message: "" };
const requiredColumns = "name, slug, industry, location, cv_requirement, minimum_bid, bid_increment, withdrawal_penalty_percent, response_duration_minutes, bidding_mode, inactivity_timeout_seconds";

export function CompanyCsvImport() {
  const [filename, setFilename] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (
    previousState: ActionState,
    formData: FormData,
  ) => {
    const result = await importCompanies(previousState, formData);
    if (result.ok) {
      formRef.current?.reset();
      setFilename("");
    }
    return result;
  }, initialState);

  function downloadTemplate() {
    const headings = `${requiredColumns},description,available_roles,required_skills,maximum_bid,opens_at,closes_at`;
    const example = 'Acme Lanka,acme-lanka,Software,Colombo,10,10,5,10,10,committee,120,"Engineering internships",Software Engineering|Quality Engineering,React|SQL,100,2026-09-01T09:00,2026-09-08T17:00';
    const url = URL.createObjectURL(
      new Blob([`${headings}\n${example}\n`], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "company-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="dashboard-section csv-import-section">
      <div className="form-section-title">
        <span><Building2 /></span>
        <div>
          <h3>Import companies from CSV</h3>
          <p>Add multiple fully validated companies to the upcoming catalogue.</p>
        </div>
      </div>

      <p className="csv-required-columns">
        <strong>Required columns on every row</strong>
        <code>{requiredColumns}</code>
      </p>

      <div className="csv-import-rules">
        <span><strong>Required values</strong>A missing column or blank required cell rejects the whole file.</span>
        <span><strong>Optional values</strong>Description, roles, skills, maximum bid, and schedule dates may be blank.</span>
        <span><strong>Import result</strong>Every valid company is created with Upcoming status and its minimum bid.</span>
      </div>

      <form ref={formRef} action={action} className="csv-import-form">
        <label className="csv-file-field">
          <Upload />
          <span>
            <strong>{filename || "Choose a company CSV file"}</strong>
            <small>Use | between multiple roles or skills · Maximum 500 KB</small>
          </span>
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            onChange={(event) => setFilename(event.target.files?.[0]?.name ?? "")}
          />
        </label>
        <div className="csv-import-actions">
          <button type="button" className="button button-ghost button-small" onClick={downloadTemplate}>
            <Download /> Download template
          </button>
          <button className="button button-primary button-small" disabled={pending || !filename}>
            {pending ? <><LoaderCircle className="spin" /> Importing…</> : <><Upload /> Import companies</>}
          </button>
        </div>
      </form>

      {state.message && (!filename || !state.ok) && (
        <p className={state.ok ? "inline-success" : "inline-error"} aria-live="polite">
          {state.message}
        </p>
      )}
      <p className="csv-import-warning">
        Imports are all-or-nothing. Duplicate slugs or any invalid row prevent every company in the file from being added.
      </p>
    </section>
  );
}
