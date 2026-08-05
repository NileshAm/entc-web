"use client";

import { Download } from "lucide-react";

export function CsvExport({ filename, rows, label = "Export CSV" }: { filename: string; rows: Record<string, string | number | null>[]; label?: string }) {
  function download() {
    if (!rows.length) return;
    const headings = Object.keys(rows[0]);
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [headings.map(escape).join(","), ...rows.map((row) => headings.map((heading) => escape(row[heading])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return <button className="button button-ghost" onClick={download} disabled={!rows.length}><Download size={16} /> {label}</button>;
}
