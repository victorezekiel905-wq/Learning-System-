"use client";
import { MARK, tableToText } from "./question-import";
import { parseCsv, parseXlsx } from "./roster-file";

/*
 * Reads a question file in the browser into text for parseQuestions: Word (.docx),
 * Excel (.xlsx), CSV, or plain text. Nothing is uploaded while reading.
 */

/** paragraphs: the text is a Word file's paragraphs, one per line. */
export async function readQuestionFile(file: File): Promise<{ text: string; error?: string; paragraphs?: boolean }> {
  const name = file.name.toLowerCase();
  if (file.size > 10 * 1024 * 1024) return { text: "", error: "That file is over 10 MB. Split it, or paste the questions instead." };
  if (/\.(doc|xls|ppt|pptx|odt|rtf)$/.test(name)) {
    return { text: "", error: name.endsWith(".doc") ? "Old Word (.doc) files can't be read. In Word choose File → Save As → Word Document (.docx)." :
      name.endsWith(".xls") ? "Old Excel (.xls) files can't be read. In Excel choose File → Save As → Excel Workbook (.xlsx)." :
      "Use a Word (.docx), Excel (.xlsx), CSV or text file, or copy the questions and paste them." };
  }
  if (name.endsWith(".pdf")) return { text: "", error: "PDF files can't be read here. Open the PDF, select the questions, copy, and paste them in the box." };
  try {
    if (name.endsWith(".docx")) return { text: await docxText(await file.arrayBuffer()), paragraphs: true };
    if (name.endsWith(".xlsx")) return { text: tableToText(await parseXlsx(await file.arrayBuffer())) };
    if (name.endsWith(".csv")) return { text: tableToText(parseCsv(await file.text())) };
    return { text: await file.text() };
  } catch {
    return { text: "", error: "That file couldn't be read. Is it open in another program, or damaged? Try saving it again, or paste the questions." };
  }
}

const on = (el: Element | null, attr = "w:val") => {
  if (!el) return false;
  const v = (el.getAttribute(attr) ?? "").toLowerCase();
  return v !== "0" && v !== "false" && v !== "none" && v !== "off";
};

/** A run that stands out: bold, underlined, highlighted, shaded or in a colour. */
function stands(rPr: Element | null): boolean {
  if (!rPr) return false;
  const child = (tag: string) => Array.from(rPr.children).find((c) => c.tagName === tag) ?? null;
  const color = (child("w:color")?.getAttribute("w:val") ?? "auto").toLowerCase();
  const fill = (child("w:shd")?.getAttribute("w:fill") ?? "auto").toLowerCase();
  return on(child("w:b")) || on(child("w:u")) || on(child("w:highlight"))
    || (color !== "auto" && color !== "000000") || (fill !== "auto" && fill !== "ffffff" && fill !== "");
}

/**
 * Word text, one paragraph per line. Word's own numbering becomes "1." for
 * numbered lists and "A." for lettered ones, and text that stands out is tagged
 * so a bold or coloured option can be taken as the answer.
 */
async function docxText(data: ArrayBuffer): Promise<string> {
  // Loaded only when a file is chosen, so pages that never read one stay light.
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const read = async (path: string) => {
    const f = zip.file(path);
    return f ? new DOMParser().parseFromString(await f.async("text"), "application/xml") : null;
  };
  const doc = await read("word/document.xml");
  if (!doc) throw new Error("not a Word document");
  const numbering = await read("word/numbering.xml");

  // numId → abstract list → format of each level.
  const formats = new Map<string, string>();
  const abstractOf = new Map<string, string>();
  for (const n of Array.from(numbering?.getElementsByTagName("w:num") ?? [])) {
    const a = n.getElementsByTagName("w:abstractNumId")[0]?.getAttribute("w:val");
    if (a) abstractOf.set(n.getAttribute("w:numId") ?? "", a);
  }
  for (const a of Array.from(numbering?.getElementsByTagName("w:abstractNum") ?? [])) {
    for (const lvl of Array.from(a.getElementsByTagName("w:lvl"))) {
      formats.set(`${a.getAttribute("w:abstractNumId")}:${lvl.getAttribute("w:ilvl")}`, lvl.getElementsByTagName("w:numFmt")[0]?.getAttribute("w:val") ?? "decimal");
    }
  }

  const counters = new Map<string, number>();
  let letters = 0;
  const lines: string[] = [];
  for (const p of Array.from(doc.getElementsByTagName("w:p"))) {
    // Text boxes appear twice (new and old format); read only the new one.
    if (hasAncestor(p, "mc:Fallback")) continue;
    let text = "";
    for (const r of Array.from(p.getElementsByTagName("w:r"))) {
      let t = "";
      for (const c of Array.from(r.children)) {
        if (c.tagName === "w:t") t += c.textContent ?? "";
        else if (c.tagName === "w:tab") t += "  ";
        else if (c.tagName === "w:br" || c.tagName === "w:cr") t += "\n";
      }
      const rPr = Array.from(r.children).find((c) => c.tagName === "w:rPr") ?? null;
      text += t.trim() && stands(rPr) ? `${t}${MARK}` : t;
    }

    const numPr = p.getElementsByTagName("w:numPr")[0];
    let prefix = "";
    if (numPr && text.trim()) {
      const numId = numPr.getElementsByTagName("w:numId")[0]?.getAttribute("w:val") ?? "";
      const ilvl = numPr.getElementsByTagName("w:ilvl")[0]?.getAttribute("w:val") ?? "0";
      const fmt = formats.get(`${abstractOf.get(numId)}:${ilvl}`) ?? "decimal";
      if (numId !== "0") {
        const key = `${numId}:${ilvl}`;
        const count = (counters.get(key) ?? 0) + 1;
        counters.set(key, count);
        for (const k of [...counters.keys()]) if (k.startsWith(`${numId}:`) && Number(k.split(":")[1]) > Number(ilvl)) counters.delete(k);
        if (fmt === "decimal" || fmt === "decimalZero") { prefix = `${count}. `; letters = 0; }
        else if (/letter|roman/i.test(fmt)) prefix = `${String.fromCharCode(65 + Math.min(letters++, 7))}. `;
        else if (fmt !== "none") prefix = "- ";
      }
    }
    lines.push(...`${prefix}${text}`.split("\n"));
  }
  return lines.join("\n");
}

function hasAncestor(el: Element, tag: string): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === tag) return true;
  return false;
}
