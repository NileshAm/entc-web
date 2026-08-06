import { companyInputValues, companySchema } from "./company-validation";
import { normalizeCsvHeader, parseCsvRecords } from "./csv";

export const requiredCompanyCsvColumns = [
  "name",
  "slug",
  "industry",
  "location",
  "cv_requirement",
  "minimum_bid",
  "bid_increment",
  "withdrawal_penalty_percent",
  "response_duration_minutes",
  "bidding_mode",
  "inactivity_timeout_seconds",
] as const;

const optionalCompanyCsvColumns = [
  "description",
  "available_roles",
  "required_skills",
  "maximum_bid",
  "opens_at",
  "closes_at",
] as const;

const allCompanyCsvColumns = new Set<string>([
  ...requiredCompanyCsvColumns,
  ...optionalCompanyCsvColumns,
]);

const csvFieldForInput: Record<string, string> = {
  cvRequirement: "cv_requirement",
  minimumBid: "minimum_bid",
  bidIncrement: "bid_increment",
  maximumBid: "maximum_bid",
  withdrawalPenaltyPercent: "withdrawal_penalty_percent",
  responseDurationMinutes: "response_duration_minutes",
  biddingMode: "bidding_mode",
  inactivityTimeoutSeconds: "inactivity_timeout_seconds",
  opensAt: "opens_at",
  closesAt: "closes_at",
  roles: "available_roles",
  skills: "required_skills",
};

function normalizedList(value: string) {
  return value.replace(/[|;]/g, ",");
}

export function parseCompanyCsv(csv: string) {
  const records = parseCsvRecords(csv);
  if (!records.length) throw new Error("The CSV file is empty.");

  const headers = records[0].map(normalizeCsvHeader);
  const missingColumns = requiredCompanyCsvColumns.filter(
    (column) => !headers.includes(column),
  );
  if (missingColumns.length) {
    throw new Error(`The company CSV is missing required columns: ${missingColumns.join(", ")}.`);
  }

  for (const column of allCompanyCsvColumns) {
    if (headers.filter((header) => header === column).length > 1) {
      throw new Error(`The company CSV contains more than one "${column}" column.`);
    }
  }

  const columnValue = (record: string[], column: string) => {
    const columnIndex = headers.indexOf(column);
    return columnIndex === -1 ? "" : (record[columnIndex] ?? "").trim();
  };
  const companies: Array<ReturnType<typeof companyInputValues> & { current_bid: number }> = [];
  const seenSlugs = new Set<string>();

  for (let recordIndex = 1; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    const rowNumber = recordIndex + 1;

    for (const column of requiredCompanyCsvColumns) {
      if (!columnValue(record, column)) {
        throw new Error(`CSV row ${rowNumber} is missing the required "${column}" value.`);
      }
    }

    const parsed = companySchema.safeParse({
      name: columnValue(record, "name"),
      slug: columnValue(record, "slug"),
      industry: columnValue(record, "industry"),
      location: columnValue(record, "location"),
      description: columnValue(record, "description"),
      roles: normalizedList(columnValue(record, "available_roles")),
      skills: normalizedList(columnValue(record, "required_skills")),
      cvRequirement: columnValue(record, "cv_requirement"),
      minimumBid: columnValue(record, "minimum_bid"),
      bidIncrement: columnValue(record, "bid_increment"),
      maximumBid: columnValue(record, "maximum_bid"),
      withdrawalPenaltyPercent: columnValue(record, "withdrawal_penalty_percent"),
      responseDurationMinutes: columnValue(record, "response_duration_minutes"),
      biddingMode: columnValue(record, "bidding_mode").toLowerCase(),
      inactivityTimeoutSeconds: columnValue(record, "inactivity_timeout_seconds"),
      opensAt: columnValue(record, "opens_at"),
      closesAt: columnValue(record, "closes_at"),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const inputField = String(issue?.path[0] ?? "value");
      const csvField = csvFieldForInput[inputField] ?? inputField;
      throw new Error(`CSV row ${rowNumber} has an invalid "${csvField}" value: ${issue?.message ?? "check this field"}.`);
    }

    const value = parsed.data;
    if (value.maximumBid !== "" && value.maximumBid < value.minimumBid) {
      throw new Error(`CSV row ${rowNumber} has a maximum_bid below its minimum_bid.`);
    }
    if (seenSlugs.has(value.slug)) {
      throw new Error(`The company slug "${value.slug}" appears more than once in the CSV.`);
    }

    let companyValues: ReturnType<typeof companyInputValues>;
    try {
      companyValues = companyInputValues(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Check the company schedule.";
      throw new Error(`CSV row ${rowNumber}: ${message}`);
    }
    if (
      companyValues.closes_at &&
      companyValues.opens_at &&
      companyValues.closes_at <= companyValues.opens_at
    ) {
      throw new Error(`CSV row ${rowNumber} must close after it opens.`);
    }

    seenSlugs.add(value.slug);
    companies.push({ ...companyValues, current_bid: value.minimumBid });
  }

  if (!companies.length) throw new Error("The CSV does not contain any company rows.");
  return companies;
}
