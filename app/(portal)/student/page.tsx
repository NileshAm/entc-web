import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, Bookmark, Coins, Gavel, History, TrendingUp, WalletCards } from "lucide-react";
import { markNotificationRead } from "@/app/actions";
import { CompanyCard } from "@/components/company-card";
import { StatusBadge } from "@/components/status-badge";
import { availablePoints, formatDateTime } from "@/lib/business";
import { requireProfile } from "@/lib/auth";
import { getStudentOverviewData } from "@/lib/data";

export default async function StudentPage({
  searchParams,
}: {
  searchParams: Promise<{ forcedWithdrawal?: string | string[] }>;
}) {
  const query = await searchParams;
  const showForcedWithdrawal = query.forcedWithdrawal === "1";
  const profile = await requireProfile(["student"]);
  const { companies, applications, notifications } = await getStudentOverviewData(profile.id);
  const available = availablePoints(profile);
  const liveCompany = companies.find((company) => ["open", "bid_increase_pending"].includes(company.status));
  const activeApplications = applications.filter((application) => ["active_bid", "confirmed", "confirmation_required"].includes(application.status));
  const unread = notifications.filter((notification) => !notification.read_at);

  return (
    <div className="dashboard-page">
      {showForcedWithdrawal && (
        <div className="forced-withdrawal-notice" role="alert">
          <AlertTriangle />
          <span><strong>Force withdrawal completed</strong>Your response timer expired. You were withdrawn from the company and the normal withdrawal charge was deducted from your points.</span>
        </div>
      )}
      <div className="page-title-row">
        <div><span className="page-kicker">STUDENT OVERVIEW</span><h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {profile.full_name.split(" ")[0]}.</h1><p>Here’s what’s happening with your internship bidding.</p></div>
        <Link className="button button-dark" href="/student/companies">Explore companies <ArrowRight size={17} /></Link>
      </div>

      <section className="metric-grid student-metrics" aria-label="Point balance summary">
        <article className="metric-card emphasis"><span className="metric-icon"><WalletCards /></span><div><small>AVAILABLE POINTS</small><strong>{available}</strong><p>Ready to bid</p></div></article>
        <article className="metric-card"><span className="metric-icon amber"><Bookmark /></span><div><small>RESERVED</small><strong>{profile.reserved_points}</strong><p>Across {activeApplications.length} active {activeApplications.length === 1 ? "bid" : "bids"}</p></div></article>
        <article className="metric-card"><span className="metric-icon purple"><Coins /></span><div><small>SPENT</small><strong>{profile.spent_points}</strong><p>Finalized applications</p></div></article>
        <article className="metric-card"><span className="metric-icon blue"><History /></span><div><small>ACTIVE APPLICATIONS</small><strong>{activeApplications.length}</strong><p>{applications.length} total applications</p></div></article>
      </section>

      {liveCompany ? (
        <section className="dashboard-section live-section">
          <div className="section-title-row"><div><span className="live-label"><span className="live-dot" /> LIVE BIDDING</span><h2>Open right now</h2></div><span className="section-note">Closes {formatDateTime(liveCompany.closes_at)}</span></div>
          <CompanyCard company={liveCompany} availablePoints={available} featured />
        </section>
      ) : (
        <section className="no-live-banner"><Gavel /><div><strong>No company is live right now</strong><span>Check the upcoming catalogue while the committee prepares the next session.</span></div><Link href="/student/companies">View upcoming <ArrowRight size={16} /></Link></section>
      )}

      <div className="dashboard-columns">
        <section className="dashboard-section">
          <div className="section-title-row"><div><span className="page-kicker">YOUR BIDS</span><h2>Recent applications</h2></div><Link href="/student/activity">View history <ArrowRight size={15} /></Link></div>
          <div className="simple-list">
            {applications.slice(0, 4).map((application) => (
              <div key={application.id} className="simple-list-row">
                <span className="list-icon"><Gavel size={18} /></span>
                <span className="list-copy"><strong>{application.company?.name}</strong><small>{formatDateTime(application.applied_at)}</small></span>
                <strong className="list-points">{application.final_points_deducted || application.reserved_points || application.accepted_bid} pts</strong>
                <StatusBadge status={application.status} />
              </div>
            ))}
            {!applications.length && <div className="empty-list"><p>You haven’t applied to a company yet.</p><Link href="/student/companies">Browse companies</Link></div>}
          </div>
        </section>

        <section className="dashboard-section notifications-card" id="notifications">
          <div className="section-title-row"><div><span className="page-kicker">UPDATES</span><h2>Notifications</h2></div>{unread.length > 0 && <span className="notification-count">{unread.length} new</span>}</div>
          <div className="notification-list">
            {notifications.slice(0, 5).map((notification) => (
              <form key={notification.id} action={markNotificationRead.bind(null, notification.id)} className={!notification.read_at ? "unread" : ""}>
                <button type="submit" aria-label={`Mark ${notification.title} as read`}><span className="notification-icon"><Bell size={16} /></span><span><strong>{notification.title}</strong><small>{notification.message}</small><time>{formatDateTime(notification.created_at)}</time></span></button>
              </form>
            ))}
            {!notifications.length && <div className="empty-list"><p>You’re all caught up.</p></div>}
          </div>
        </section>
      </div>
      <aside className="dashboard-tip"><TrendingUp /><span><strong>How bid increases work</strong>The committee may increase an oversubscribed company’s current bid. You will be notified to choose Stay or Withdraw before the response deadline.</span></aside>
    </div>
  );
}
