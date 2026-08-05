import type { Metadata } from "next";
import { ArrowDownLeft, ArrowUpRight, Coins, Gavel } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { availablePoints, formatDateTime } from "@/lib/business";
import { requireProfile } from "@/lib/auth";
import { getStudentData } from "@/lib/data";

export const metadata: Metadata = { title: "My activity" };

export default async function ActivityPage() {
  const current = await requireProfile(["student"]);
  const { profile, applications, transactions } = await getStudentData(current.id);
  return (
    <div className="dashboard-page">
      <div className="page-title-row"><div><span className="page-kicker">MY ACTIVITY</span><h1>Every bid. Every point.</h1><p>Your complete application and point transaction history.</p></div><div className="balance-pill"><span>Current available balance</span><strong>{availablePoints(profile)} points</strong></div></div>
      <div className="activity-layout">
        <section className="dashboard-section"><div className="section-title-row"><div><span className="page-kicker">APPLICATIONS</span><h2>Application timeline</h2></div></div><div className="timeline-list">{applications.map((application) => <article key={application.id}><span className="timeline-dot"><Gavel /></span><div><div className="timeline-head"><strong>{application.company?.name}</strong><StatusBadge status={application.status} /></div><p>Accepted bid: {application.accepted_bid} points · Reserved: {application.reserved_points} points</p><time>{formatDateTime(application.applied_at)}</time></div></article>)}{!applications.length && <div className="empty-list">No application activity yet.</div>}</div></section>
        <section className="dashboard-section"><div className="section-title-row"><div><span className="page-kicker">POINT LEDGER</span><h2>Transactions</h2></div></div><div className="transaction-list">{transactions.map((transaction) => { const positive = transaction.type === "release" || transaction.type === "refund" || transaction.amount > 0 && transaction.type === "adjustment"; return <article key={transaction.id}><span className={`transaction-icon ${positive ? "positive" : ""}`}>{positive ? <ArrowDownLeft /> : <ArrowUpRight />}</span><div><strong>{transaction.description}</strong><small>{transaction.company?.name ?? "Account adjustment"} · {formatDateTime(transaction.created_at)}</small></div><span className={positive ? "positive-text" : ""}>{positive ? "+" : "−"}{Math.abs(transaction.amount)} pts<small>{transaction.balance_before} → {transaction.balance_after}</small></span></article>; })}{!transactions.length && <div className="empty-list"><Coins /><p>No point transactions yet.</p></div>}</div></section>
      </div>
    </div>
  );
}
