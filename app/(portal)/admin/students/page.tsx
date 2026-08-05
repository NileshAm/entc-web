import type { Metadata } from "next";
import { CsvExport } from "@/components/csv-export";
import { StudentTable } from "@/components/student-table";
import { availablePoints } from "@/lib/business";
import { requireProfile } from "@/lib/auth";
import { getAdminData } from "@/lib/data";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage() {
  const profile = await requireProfile(["admin", "viewer"]);
  const { students } = await getAdminData();
  const rows = students.map((student) => ({ registration_number: student.registration_number, full_name: student.full_name, email: student.email, initial_points: student.initial_points, available_points: availablePoints(student), reserved_points: student.reserved_points, spent_points: student.spent_points, status: student.account_status }));
  return <div className="dashboard-page"><div className="page-title-row"><div><span className="page-kicker">BATCH DIRECTORY</span><h1>Students & point balances</h1><p>Review participation and manage audited point adjustments.</p></div><CsvExport filename="student-point-balances" rows={rows} /></div><section className="dashboard-section"><StudentTable students={students} readOnly={profile.role !== "admin"} /></section></div>;
}
