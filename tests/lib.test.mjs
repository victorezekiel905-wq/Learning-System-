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
