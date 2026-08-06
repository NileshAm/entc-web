import { normalizeCsvHeader, parseCsvRecords } from "./csv";

export interface StudentIpCsvRow {
  index_number: string;
  total: number;
}

const indexHeaderAliases = new Set([
  "index",
  "index_no",
  "index_number",
  "registration_number",
  "student_index",
  "student_index_number",
]);

export function parseStudentIpCsv(csv: string): StudentIpCsvRow[] {
  const records = parseCsvRecords(csv);
  if (!records.length) throw new Error("The CSV file is empty.");

  const headers = records[0].map(normalizeCsvHeader);
  const indexColumn = headers.findIndex((header) => indexHeaderAliases.has(header));
  const totalColumn = headers.indexOf("total");

  if (indexColumn === -1 || totalColumn === -1) {
    throw new Error('The CSV must contain "index number" and "total" columns.');
  }
  if (headers.filter((header) => header === "total").length > 1) {
    throw new Error('The CSV contains more than one "total" column.');
  }
  if (headers.filter((header) => indexHeaderAliases.has(header)).length > 1) {
    throw new Error("The CSV contains more than one student index column.");
  }

  const rows: StudentIpCsvRow[] = [];
  const seenIndexes = new Set<string>();

  for (let recordIndex = 1; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    const rowNumber = recordIndex + 1;
    const indexNumber = (record[indexColumn] ?? "").trim().toUpperCase();
    const totalText = (record[totalColumn] ?? "").trim();

    if (!indexNumber) throw new Error(`CSV row ${rowNumber} has no index number.`);
    if (!/^\d+$/.test(totalText)) {
      throw new Error(`CSV row ${rowNumber} must contain a non-negative whole-number total.`);
    }

    const total = Number(totalText);
    if (!Number.isSafeInteger(total) || total > 2_147_483_647) {
      throw new Error(`CSV row ${rowNumber} has a total that is too large.`);
    }
    if (seenIndexes.has(indexNumber)) {
      throw new Error(`The index number ${indexNumber} appears more than once in the CSV.`);
    }

    seenIndexes.add(indexNumber);
    rows.push({ index_number: indexNumber, total });
  }

  if (!rows.length) throw new Error("The CSV does not contain any student rows.");
  return rows;
}
