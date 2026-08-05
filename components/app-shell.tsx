"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  ChevronDown,
  Gavel,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { signOut } from "@/app/actions";
import { Logo } from "@/components/logo";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { initials } from "@/lib/business";
import type { Profile } from "@/lib/types";

const studentNavigation = [
  { href: "/student", label: "Overview", icon: LayoutDashboard },
  { href: "/student/companies", label: "Companies", icon: Building2 },
  { href: "/student/activity", label: "My activity", icon: Activity },
];

const adminNavigation = [
  { href: "/admin", label: "Live dashboard", icon: Gavel },
  { href: "/admin/companies", label: "Companies", icon: Building2 },
  { href: "/admin/students", label: "Students", icon: Users },
  { href: "/analytics", label: "Public analytics", icon: BarChart3 },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigation = profile.role === "student" ? studentNavigation : adminNavigation;

  return (
    <div className="portal-shell">
      <aside className={`portal-sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <Logo />
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button>
        </div>
        <div className="sidebar-context">
          <span>{profile.role === "student" ? "STUDENT PORTAL" : profile.role === "admin" ? "ADMIN CONSOLE" : "COMMITTEE VIEW"}</span>
          <strong>2026 Internship Batch</strong>
        </div>
        <nav className="portal-nav" aria-label="Portal navigation">
          {navigation.map((item) => {
            const active = item.href === pathname || (item.href !== `/${profile.role}` && pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""} onClick={() => setMobileOpen(false)}>
                <Icon size={19} /> {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="profile-mini">
            <span className="avatar">{initials(profile.full_name)}</span>
            <span><strong>{profile.full_name}</strong><small>{profile.registration_number ?? profile.role}</small></span>
            <ChevronDown size={16} />
          </div>
          <form action={signOut}>
            <button type="submit"><LogOut size={17} /> Sign out</button>
          </form>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <section className="portal-main">
        <header className="portal-header">
          <div>
            <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
            <div className="mobile-logo"><Logo compact /></div>
          </div>
          <div className="portal-header-actions">
            <RealtimeRefresh userId={profile.id} />
            <Link href={profile.role === "student" ? "/student#notifications" : "/admin"} className="icon-button" aria-label="Notifications"><Bell size={19} /></Link>
            <span className="header-avatar">{initials(profile.full_name)}</span>
          </div>
        </header>
        <main className="portal-content">{children}</main>
      </section>
    </div>
  );
}
