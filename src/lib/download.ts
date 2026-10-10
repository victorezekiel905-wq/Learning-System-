"use client";
import { toCsv } from "./utils";

export type CsvSection = { title: string; rows: Record<string, unknown>[] };

/**
 * One spreadsheet with several tables (summary, subjects, lessons...), each under its
 * title, saved as a .csv file. The byte-order mark makes Excel read ₦ and accents correctly.
 */
export function downloadCsv(fileName: string, sections: CsvSection[]) {
  const body = sections.filter((s) => s.rows.length)
    .map((s) => `${s.title}\n${toCsv(s.rows)}`).join("\n\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.replace(/[^\w .()-]+/g, "_") + (fileName.endsWith(".csv") ? "" : ".csv");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "62%" or "" for no answers yet. */
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "" : `${v}%`);
