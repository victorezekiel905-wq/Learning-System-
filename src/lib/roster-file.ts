"use client";

/*
 * Reads a class list from a CSV or Excel (.xlsx) file in the browser.
 * Recognises the usual column names: Name / Full name, or First name and
 * Surname; Email (optional); Admission number (optional).
 */

export type RosterRow = { full_name: string; email?: string; admission_no?: string };
export type RosterParse = { rows: RosterRow[]; skipped: number; error?: string };

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const NAME = ["full_name", "name", "student_name", "student", "pupil_name", "pupil", "names"];
const FIRST = ["first_name", "firstname", "given_name", "forename", "other_names", "first"];
const LAST = ["last_name", "lastname", "surname", "family_name", "last"];
const EMAIL = ["email", "email_address", "e_mail", "mail"];
const ADMISSION = ["admission_no", "admission_number", "admission", "adm_no", "admno", "reg_no", "registration_number", "student_number", "student_id", "matric_no", "id"];

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const sep = (text.split("\n")[0] ?? "").includes(";") && !(text.split("\n")[0] ?? "").includes(",") ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const colIndex = (ref: string) => {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** The first worksheet of an .xlsx file, as rows of text. */
export async function parseXlsx(data: ArrayBuffer): Promise<string[][]> {
  // Loaded only when a file is chosen, so pages that never read one stay light.
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const xml = async (path: string) => {
    const f = zip.file(path);
    return f ? new DOMParser().parseFromString(await f.async("text"), "application/xml") : null;
  };
  const book = await xml("xl/workbook.xml");
  const rels = await xml("xl/_rels/workbook.xml.rels");
  const first = book?.getElementsByTagName("sheet")[0];
  const rid = first?.getAttribute("r:id") ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  let target = "worksheets/sheet1.xml";
  for (const r of Array.from(rels?.getElementsByTagName("Relationship") ?? [])) {
    if (r.getAttribute("Id") === rid) target = r.getAttribute("Target") ?? target;
  }
  const sheet = await xml(target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  if (!sheet) throw new Error("That Excel file has no worksheet.");
  const shared = await xml("xl/sharedStrings.xml");
  const strings = Array.from(shared?.getElementsByTagName("si") ?? []).map((si) =>
    Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));
  const out: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName("row"))) {
    const cells: string[] = [];
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const i = colIndex(c.getAttribute("r") ?? "A1");
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const text = type === "s" ? strings[Number(v)] ?? ""
        : type === "inlineStr" ? Array.from(c.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("")
        : v;
      cells[i] = text;
    }
    const filled = Array.from({ length: cells.length }, (_, i) => cells[i] ?? "");
    if (filled.some((f) => f.trim())) out.push(filled);
  }
  return out;
}

/** Turns a table (header row first) into students. */
export function toRoster(table: string[][]): RosterParse {
  if (table.length < 2) return { rows: [], skipped: 0, error: "The file needs a header row and at least one student." };
  const header = table[0]!.map(norm);
  const find = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iName = find(NAME), iFirst = find(FIRST), iLast = find(LAST), iEmail = find(EMAIL), iAdm = find(ADMISSION);
  if (iName < 0 && iFirst < 0 && iLast < 0) {
    return { rows: [], skipped: 0, error: "Add a column called \"Name\" (or \"First name\" and \"Surname\") in the first row." };
  }
  const rows: RosterRow[] = [];
  let skipped = 0;
  for (const r of table.slice(1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const name = iName >= 0 ? cell(iName) : [cell(iFirst), cell(iLast)].filter(Boolean).join(" ");
    if (!name) { skipped++; continue; }
    rows.push({ full_name: name, ...(cell(iEmail) ? { email: cell(iEmail) } : {}), ...(cell(iAdm) ? { admission_no: cell(iAdm) } : {}) });
  }
  return { rows, skipped };
}

/** Reads a chosen file (.csv, .txt or .xlsx). */
export async function readRosterFile(file: File): Promise<RosterParse> {
  if (/\.xls$/i.test(file.name)) return { rows: [], skipped: 0, error: "Old Excel (.xls) files aren't supported. In Excel choose File → Save As → Excel Workbook (.xlsx), or CSV." };
  if (/\.xlsx$/i.test(file.name)) return toRoster(await parseXlsx(await file.arrayBuffer()));
  return toRoster(parseCsv(await file.text()));
}
