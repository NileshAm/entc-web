import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { CsvExport } from "@/components/csv-export";
import { formatDateTime, formatStatus } from "@/lib/business";
import { requireProfile } from "@/lib/auth";
import { getAdminData } from "@/lib/data";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requireProfile(["admin", "viewer"]);
  const { auditLogs } = await getAdminData();
  const rows = auditLogs.map((log) => ({ timestamp: log.created_at, actor: log.actor?.full_name ?? "System", role: log.actor_role, action: log.action, entity_type: log.entity_type, entity_id: log.entity_id, reason: log.reason }));
  return <div className="dashboard-page"><div className="page-title-row"><div><span className="page-kicker">ACCOUNTABILITY</span><h1>System audit log</h1><p>Critical status, bid, application, and point events in one immutable trail.</p></div><CsvExport filename="audit-log" rows={rows} /></div><section className="dashboard-section"><div className="audit-list">{auditLogs.map((log) => <article key={log.id}><span className="audit-icon"><ScrollText /></span><div><strong>{formatStatus(log.action.replaceAll(".", "_"))}</strong><p>{log.actor?.full_name ?? "System process"} · {formatStatus(log.actor_role ?? "system")}</p><small>{log.entity_type} {log.entity_id ? `· ${log.entity_id.slice(0, 8)}…` : ""}{log.reason ? ` · ${log.reason}` : ""}</small></div><time>{formatDateTime(log.created_at)}</time></article>)}{!auditLogs.length && <div className="empty-state"><ScrollText /><h3>No audited events yet</h3><p>Critical actions will appear here.</p></div>}</div></section></div>;
}
