"use client";

import { useActionState, useRef, useState } from "react";
import { Download, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { importStudentIpPoints } from "@/app/actions";
import type { ActionState } from "@/lib/types";

const initialState: ActionState = { ok: false, message: "" };

export function StudentIpImport() {
  const [filename, setFilename] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (
    previousState: ActionState,
    formData: FormData,
  ) => {
    const result = await importStudentIpPoints(previousState, formData);
    if (result.ok) {
      formRef.current?.reset();
      setFilename("");
    }
    return result;
  }, initialState);

  function downloadTemplate() {
    const csv = "index number,total\n200012A,95\n200013B,80\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "student-ip-points-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="dashboard-section csv-import-section">
      <div className="form-section-title">
        <span><FileSpreadsheet /></span>
        <div>
          <h3>Import IP points from CSV</h3>
          <p>Set the exact IP allocation for the whole student batch in one audited import.</p>
        </div>
      </div>

      <div className="csv-import-rules">
        <span><strong>Matched index</strong>Uses the row’s <code>total</code>.</span>
        <span><strong>Missing from CSV</strong>Sets the site student to 80 points.</span>
        <span><strong>Unknown index</strong>Ignores the CSV row without changing data.</span>
      </div>

      <form ref={formRef} action={action} className="csv-import-form">
        <label className="csv-file-field">
          <Upload />
          <span>
            <strong>{filename || "Choose a CSV file"}</strong>
            <small>Required columns: index number, total · Maximum 500 KB</small>
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
            {pending ? <><LoaderCircle className="spin" /> Importing…</> : <><Upload /> Import and apply</>}
          </button>
        </div>
      </form>

      {state.message && (!filename || !state.ok) && (
        <p className={state.ok ? "inline-success" : "inline-error"} aria-live="polite">
          {state.message}
        </p>
      )}
      <p className="csv-import-warning">
        Imports are all-or-nothing. If a total is lower than points already reserved or spent, no student is changed.
      </p>
    </section>
  );
}
