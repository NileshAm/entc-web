import type { Metadata } from "next";
import { CsvExport } from "@/components/csv-export";
import { StudentIpImport } from "@/components/student-ip-import";
import { StudentTable } from "@/components/student-table";
import { availablePoints, ipPointTotal } from "@/lib/business";
import { requireProfile } from "@/lib/auth";
import { getAdminStudents } from "@/lib/data";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage() {
  const profile = await requireProfile(["admin", "viewer"]);
  const students = await getAdminStudents();
  const rows = students.map((student) => ({ registration_number: student.registration_number, full_name: student.full_name, email: student.email, ip_total: ipPointTotal(student), available_points: availablePoints(student), reserved_points: student.reserved_points, spent_points: student.spent_points, status: student.account_status }));
  return <div className="dashboard-page"><div className="page-title-row"><div><span className="page-kicker">BATCH DIRECTORY</span><h1>Students & IP point balances</h1><p>Import IP totals, review balances, and manage audited point changes.</p></div><CsvExport filename="student-point-balances" rows={rows} /></div>{profile.role === "admin" && <StudentIpImport />}<section className="dashboard-section"><StudentTable students={students} readOnly={profile.role !== "admin"} /></section></div>;
}
