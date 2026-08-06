import { describe, expect, it } from "vitest";
import { parseCompanyCsv, requiredCompanyCsvColumns } from "../lib/company-csv";

const headers = [
  ...requiredCompanyCsvColumns,
  "description",
  "available_roles",
  "required_skills",
  "maximum_bid",
  "opens_at",
  "closes_at",
].join(",");

const validRow = [
  "Acme Lanka",
  "acme-lanka",
  "Software",
  "Colombo",
  "10",
  "20",
  "5",
  "10",
  "15",
  "committee",
  "120",
  "Engineering internships",
  "Software Engineering|Quality Engineering",
  "React|SQL",
  "100",
  "2026-09-01T09:00",
  "2026-09-08T17:00",
].join(",");

describe("company CSV parsing", () => {
  it("accepts a file containing only the required columns", () => {
    const requiredValues = validRow.split(",").slice(0, requiredCompanyCsvColumns.length);
    const [company] = parseCompanyCsv(
      `${requiredCompanyCsvColumns.join(",")}\n${requiredValues.join(",")}`,
    );

    expect(company).toMatchObject({
      description: null,
      available_roles: [],
      required_skills: [],
      maximum_bid: null,
      opens_at: null,
      closes_at: null,
    });
  });

  it("validates required fields and converts a complete company row", () => {
    const [company] = parseCompanyCsv(`${headers}\n${validRow}`);

    expect(company).toMatchObject({
      name: "Acme Lanka",
      slug: "acme-lanka",
      available_roles: ["Software Engineering", "Quality Engineering"],
      required_skills: ["React", "SQL"],
      cv_requirement: 10,
      minimum_bid: 20,
      current_bid: 20,
      bidding_mode: "committee",
      opens_at: "2026-09-01T03:30:00.000Z",
    });
  });

  it("rejects a missing required column", () => {
    expect(() => parseCompanyCsv("name,slug\nAcme Lanka,acme-lanka")).toThrow(
      "missing required columns",
    );
  });

  it("rejects a blank required value", () => {
    const values = validRow.split(",");
    values[requiredCompanyCsvColumns.indexOf("location")] = "";
    expect(() => parseCompanyCsv(`${headers}\n${values.join(",")}`)).toThrow(
      'missing the required "location" value',
    );
  });

  it("rejects invalid bidding limits and schedules", () => {
    const lowMaximum = validRow.split(",");
    lowMaximum[14] = "10";
    expect(() => parseCompanyCsv(`${headers}\n${lowMaximum.join(",")}`)).toThrow(
      "maximum_bid below",
    );

    const badSchedule = validRow.split(",");
    badSchedule[15] = "2026-09-10T09:00";
    expect(() => parseCompanyCsv(`${headers}\n${badSchedule.join(",")}`)).toThrow(
      "must close after it opens",
    );
  });

  it("rejects duplicate slugs within one import", () => {
    expect(() => parseCompanyCsv(`${headers}\n${validRow}\n${validRow}`)).toThrow(
      "appears more than once",
    );
  });
});
