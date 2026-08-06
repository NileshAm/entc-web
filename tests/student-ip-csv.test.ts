import { describe, expect, it } from "vitest";
import { parseStudentIpCsv } from "../lib/student-ip-csv";

describe("student IP CSV parsing", () => {
  it("accepts the requested index number and total columns", () => {
    expect(parseStudentIpCsv("index number,total\n200012A,95\n200013b,80\n")).toEqual([
      { index_number: "200012A", total: 95 },
      { index_number: "200013B", total: 80 },
    ]);
  });

  it("accepts common registration-number headings and quoted values", () => {
    expect(parseStudentIpCsv('\uFEFFregistration_number,total,comment\r\n"200012A","105","Imported"')).toEqual([
      { index_number: "200012A", total: 105 },
    ]);
  });

  it("rejects missing required headings", () => {
    expect(() => parseStudentIpCsv("student,score\n200012A,90")).toThrow(
      'must contain "index number" and "total" columns',
    );
  });

  it("rejects duplicate student indexes case-insensitively", () => {
    expect(() => parseStudentIpCsv("index number,total\n200012a,90\n200012A,80")).toThrow(
      "appears more than once",
    );
  });

  it("rejects decimal and negative totals", () => {
    expect(() => parseStudentIpCsv("index number,total\n200012A,80.5")).toThrow(
      "non-negative whole-number total",
    );
    expect(() => parseStudentIpCsv("index number,total\n200012A,-1")).toThrow(
      "non-negative whole-number total",
    );
  });
});
