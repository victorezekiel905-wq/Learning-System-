// Unit tests for pure TypeScript helpers (Node strips the types natively).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const load = (p) => import(pathToFileURL(p).href);
const utils = await load("src/lib/utils.ts");
const errors = await load("src/lib/errors.ts");
const importer = await load("src/lib/lesson-import.ts");

test("safeNext only allows same-origin relative paths", () => {
  assert.equal(utils.safeNext("/teacher/live"), "/teacher/live");
  assert.equal(utils.safeNext("//evil.com"), "/dashboard");
  assert.equal(utils.safeNext("/\\evil.com"), "/dashboard");
  assert.equal(utils.safeNext("https://evil.com"), "/dashboard");
  assert.equal(utils.safeNext(null), "/dashboard");
});

test("toCsv quotes values and neutralises spreadsheet formulas", () => {
  const csv = utils.toCsv([{ name: 'Ada, "the first"', score: 9 }, { name: "=HYPERLINK(\"x\")", score: -1 }]);
  const [header, a, b] = csv.split("\n");
  assert.equal(header, "name,score");
  assert.equal(a, '"Ada, ""the first""",9');
  assert.ok(b.startsWith(`"'=HYPERLINK`), "formula prefixed with an apostrophe");
  assert.ok(b.endsWith(",'-1"));
});

test("splitList handles commas, spaces and newlines", () => {
  assert.deepEqual(utils.splitList("a.com, b.com\n c.com  "), ["a.com", "b.com", "c.com"]);
});

test("database errors map to HTTP status and safe messages", () => {
  assert.equal(errors.statusForError({ code: "42501", message: "x" }), 403);
  assert.equal(errors.statusForError({ code: "P0002", message: "x" }), 404);
  assert.equal(errors.statusForError({ code: "28000", message: "x" }), 401);
  assert.equal(errors.statusForError({ code: "XX000", message: "x" }), 500);
  assert.equal(errors.messageForError({ code: "42501", message: "new row violates row-level security policy" }), "You don't have permission to do that.");
  assert.equal(errors.messageForError({ code: "XX000", message: "relation secret_table does not exist" }), "Something went wrong. Please try again.");
  assert.equal(errors.messageForError({ code: "P0001", message: "No attempts left for this activity." }), "No attempts left for this activity.");
});

test("lesson importer turns markdown into safe text slides", async () => {
  const md = "# Intro to HTML\nWelcome!\n\n## Tags\n- <a> links\n- <p> paragraphs\n\n## Attributes\nhref and src.";
  const r = await importer.importLessonFromUpload({ filename: "html_basics.md", mimeType: "text/markdown", bytes: new TextEncoder().encode(md) });
  assert.equal(r.sourceType, "md");
  assert.ok(r.slides.length >= 3);
  assert.equal(r.slides[0].kind, "title");
  const tags = r.slides.find((s) => s.title === "Tags");
  assert.ok(tags, "section headings become slide titles");
  assert.equal(tags.body, "- <a> links\n- <p> paragraphs", "bullets preserved, markup left as plain text (rendered escaped)");
  await assert.rejects(importer.importLessonFromUpload({ filename: "x.exe", mimeType: "", bytes: new Uint8Array() }), /Unsupported file type/);
});

test("school brand colours are made readable (white text >= 4.5:1), strong colours untouched", async () => {
  const theme = await load("src/lib/theme.ts");
  const hex = (t) => "#" + t.split(" ").map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  for (const pick of ["#ffff00", "#7dd3fc", "#f9a8d4", "#22c55e", "#ffffff", "#0891b2"]) {
    const v = theme.paletteVars("brand", pick);
    const c = theme.contrastWithWhite(hex(v["--brand-600"]));
    assert.ok(c >= 4.5, `${pick} → ${hex(v["--brand-600"])} contrast ${c.toFixed(2)}`);
  }
  // Already-dark brand colours are kept exactly as chosen.
  assert.equal(theme.paletteVars("brand", "#4f46e5")["--brand-600"], "79 70 229");
  assert.equal(theme.paletteVars("brand", "#1e3a8a")["--brand-600"], "30 58 138");
});

test("accent keeps the picked colour and chooses readable text on it", async () => {
  const theme = await load("src/lib/theme.ts");
  const lime = theme.paletteVars("accent", "#c8f03c");
  assert.equal(lime["--accent-500"], "200 240 60");
  assert.equal(lime["--accent-ink"], "21 20 17", "ink text on lime");
  assert.equal(theme.paletteVars("accent", "#1e3a8a")["--accent-ink"], "255 255 255", "white text on navy");
});

test("a dropped connection is reported as a network problem (and never as a server rejection)", async () => {
  const errors = await load("src/lib/errors.ts");
  for (const m of ["TypeError: Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "fetch failed"]) {
    assert.equal(errors.isNetworkMessage(m), true, m);
    assert.equal(errors.messageForError({ message: m }), errors.NETWORK_MESSAGE);
  }
  // Real server answers keep their meaning.
  assert.equal(errors.isNetworkMessage("Invalid login credentials"), false);
  assert.equal(errors.messageForError({ message: "You already answered this question.", code: "P0001" }), "You already answered this question.");
  assert.equal(errors.messageForError({ message: "boom" }), "Something went wrong. Please try again.");
});

test("pen-test fixes: formula-safe CSV headers, safe link schemes, no protocol-relative links", async () => {
  const utils = await load("src/lib/utils.ts");
  const csv = utils.toCsv([{ "=cmd|' /C calc'!A0": 1, Name: "Ada" }]);
  assert.ok(csv.startsWith("'=cmd"), "header neutralised");
  assert.equal(utils.safeHref("javascript:alert(1)"), null);
  assert.equal(utils.safeHref("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(utils.safeHref("https://example.org/x"), "https://example.org/x");
  assert.equal(utils.safeHref("mailto:office@school.org"), "mailto:office@school.org");
  assert.equal(utils.safeHref("not a url"), null);
});

test("links use the real address, never a leftover localhost setting", async () => {
  const { appOrigin } = await load("src/lib/app-url.ts");
  const was = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  assert.equal(appOrigin("https://app.synergyswift.com"), "https://app.synergyswift.com", "production visit ignores a localhost setting");
  assert.equal(appOrigin("http://localhost:3100"), "http://localhost:3000", "local development keeps it");
  process.env.NEXT_PUBLIC_APP_URL = "https://app.synergyswift.com/";
  assert.equal(appOrigin("https://preview.vercel.app"), "https://app.synergyswift.com", "a real setting wins");
  delete process.env.NEXT_PUBLIC_APP_URL;
  assert.equal(appOrigin("https://school.example"), "https://school.example");
  if (was !== undefined) process.env.NEXT_PUBLIC_APP_URL = was;
});

/** A tiny two-page 16:9 PDF: a coloured title page and a text page. */
function samplePdf() {
  const pages = [
    "0.14 0.25 0.83 rg 0 0 960 540 re f BT /F1 64 Tf 1 1 1 rg 60 280 Td (Equivalent fractions) Tj ET",
    "1 1 1 rg 0 0 960 540 re f BT /F1 44 Tf 0 0 0 rg 60 400 Td (Why 2/4 = 1/2) Tj ET"
  ];
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
  pages.forEach((c, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  });
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

test("PDF import keeps the original look: every page becomes a JPEG picture, with its text", async () => {
  const r = await importer.renderPdfPages(samplePdf(), { width: 800 });
  assert.equal(r.total, 2);
  assert.equal(r.pages.length, 2);
  for (const p of r.pages) {
    assert.equal(p.width, 800);
    assert.equal(p.height, 450, "16:9 kept");
    assert.deepEqual([...p.jpeg.subarray(0, 2)], [0xff, 0xd8], "JPEG");
  }
  assert.match(r.pages[0].text, /Equivalent fractions/);
  assert.match(r.pages[1].text, /Why 2\/4 = 1\/2/);
  // The page limit is respected.
  assert.equal((await importer.renderPdfPages(samplePdf(), { width: 400, maxPages: 1 })).pages.length, 1);
});
