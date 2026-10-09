import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export type ImportedSlide = {
  title: string;
  body: string;
  kind: "embed" | "image" | "video" | "text" | "title";
  source: Record<string, unknown>;
};

export type LessonImportResult = {
  title: string;
  sourceType: string;
  slideCount: number;
  slides: ImportedSlide[];
};

const SUPPORTED_EXTENSIONS = new Set(["txt", "md", "markdown", "docx", "pdf", "pptx"]);

export async function importLessonFromUpload(args: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<LessonImportResult> {
  const filename = args.filename || "Imported lesson";
  const ext = extensionOf(filename);
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type: .${ext || "unknown"}. Supported: txt, md, markdown, docx, pdf, pptx.`);
  }

  if (ext === "pptx") {
    const slides = await parsePptx(args.bytes, filename);
    return {
      title: stripExtension(filename),
      sourceType: "pptx",
      slideCount: slides.length,
      slides
    };
  }

  const text = ext === "docx"
    ? await parseDocx(args.bytes)
    : ext === "pdf"
      ? await parsePdf(args.bytes)
      : decodeText(args.bytes);

  const slides = textToSlides(text, stripExtension(filename), ext);
  return {
    title: stripExtension(filename),
    sourceType: ext,
    slideCount: slides.length,
    slides
  };
}

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return (match?.[1] ?? "").toLowerCase();
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported lesson";
}

async function parseDocx(bytes: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return normalizeText(result.value);
}

async function parsePdf(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: Buffer.from(bytes) });
  const result = await parser.getText();
  await parser.destroy();
  return normalizeText(result.text);
}

async function parsePptx(bytes: Uint8Array, filename: string): Promise<ImportedSlide[]> {
  const zip = await JSZip.loadAsync(bytes);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => numberFromSlidePath(a) - numberFromSlidePath(b));

  if (slidePaths.length === 0) {
    throw new Error(`No slide XML files found in ${filename}.`);
  }

  const slides: ImportedSlide[] = [];
  for (const path of slidePaths) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const chunks = extractPptxText(xml);
    const title = chunks[0] || `Slide ${slides.length + 1}`;
    const bodyLines = chunks.slice(1);
    slides.push({
      title,
      body: toText(bodyLines.length ? bodyLines.join("\n") : title),
      kind: slides.length === 0 ? "title" : "embed",
      source: { type: "pptx", path, slideNumber: slides.length + 1 }
    });
  }

  return normalizeImportedSlides(slides, stripExtension(filename));
}

function numberFromSlidePath(path: string): number {
  const match = /slide(\d+)\.xml$/i.exec(path);
  return Number(match?.[1] ?? "0");
}

function extractPptxText(xml: string): string[] {
  const lines: string[] = [];
  const paragraphs = xml.split(/<a:p[^>]*>/i).slice(1);
  for (const part of paragraphs) {
    const beforeClose = part.split(/<\/a:p>/i)[0] ?? "";
    const texts = Array.from(beforeClose.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)).map((m) => decodeXml(m[1]));
    const raw = texts.join("").replace(/\s+/g, " ").trim();
    if (raw) lines.push(raw);
  }
  if (lines.length) return lines;
  const fallback = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)).map((m) => decodeXml(m[1]).trim()).filter(Boolean);
  return fallback;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#xA;/gi, "\n");
}

function decodeText(bytes: Uint8Array): string {
  return normalizeText(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
}

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textToSlides(text: string, fallbackTitle: string, sourceType: string): ImportedSlide[] {
  const normalized = normalizeText(text);
  if (!normalized) throw new Error("The uploaded file did not contain extractable text.");

  const sections = splitIntoSections(normalized, fallbackTitle);
  const slides: ImportedSlide[] = [];

  sections.forEach((section, sectionIndex) => {
    const chunks = chunkSection(section.body, 1100);
    if (chunks.length === 0) return;
    chunks.forEach((chunk, chunkIndex) => {
      const isFirstSlide = slides.length === 0 && sectionIndex === 0 && chunkIndex === 0;
      slides.push({
        title: chunkIndex === 0 ? section.title : `${section.title} (cont.)`,
        body: toText(chunk),
        kind: isFirstSlide ? "title" : "embed",
        source: {
          type: sourceType,
          section: section.title,
          chunk: chunkIndex + 1
        }
      });
    });
  });

  return normalizeImportedSlides(slides, fallbackTitle);
}

function splitIntoSections(text: string, fallbackTitle: string): Array<{ title: string; body: string }> {
  const lines = text.split("\n");
  const sections: Array<{ title: string; body: string }> = [];
  let currentTitle = fallbackTitle;
  let bucket: string[] = [];

  const flush = () => {
    const body = bucket.join("\n").trim();
    if (body) sections.push({ title: currentTitle, body });
    bucket = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      bucket.push("");
      continue;
    }
    if (isHeading(line)) {
      flush();
      currentTitle = line.replace(/^#+\s*/, "").trim() || currentTitle;
      continue;
    }
    bucket.push(rawLine);
  }
  flush();

  if (sections.length === 0) {
    return [{ title: fallbackTitle, body: text }];
  }
  return sections;
}

function isHeading(line: string): boolean {
  if (/^#{1,6}\s+/.test(line)) return true;
  if (/^\d+(?:\.\d+)*\s+[A-Z]/.test(line)) return true;
  if (/^(Section|Chapter|Part)\s+\d+/i.test(line)) return true;
  if (line.length <= 80 && /^[A-Z][A-Za-z0-9 ,:&()'/-]{2,}$/.test(line) && !/[.!?]$/.test(line)) return true;
  return false;
}

function chunkSection(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];
  const chunks: string[] = [];
  let current = "";

  for (const p of paragraphs) {
    if (!current) {
      current = p;
      continue;
    }
    if ((current + "\n\n" + p).length <= maxChars) {
      current += "\n\n" + p;
      continue;
    }
    chunks.push(current);
    current = p;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Plain text with '- ' bullets; rendered safely by <RichText>, never as HTML. */
function toText(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const lines = p.split("\n").map((line) => line.trim()).filter(Boolean);
      const allBullets = lines.length > 1 && lines.every((line) => /^[-*•]\s+/.test(line));
      return allBullets ? lines.map((line) => "- " + line.replace(/^[-*•]\s+/, "")).join("\n") : lines.join(" ");
    })
    .join("\n\n");
}

function normalizeImportedSlides(slides: ImportedSlide[], fallbackTitle: string): ImportedSlide[] {
  const normalized: ImportedSlide[] = [];
  for (const slide of slides) {
    if (!slide.title.trim() && !slide.body.trim()) continue;
    const index = normalized.length;
    const title = slide.title.trim() || `${fallbackTitle} ${index + 1}`;
    if (index === 0) {
      normalized.push({
        ...slide,
        title,
        kind: "title",
        body: slide.body || title
      });
      continue;
    }
    const nextKind: ImportedSlide["kind"] = slide.kind === "title" ? "embed" : slide.kind;
    normalized.push({ ...slide, title, kind: nextKind });
  }
  return normalized.slice(0, 80);
}

export type PdfPage = { page: number; jpeg: Buffer; width: number; height: number; text: string };

/**
 * Each PDF page as a picture, so an imported deck looks exactly like the original
 * (Nearpod-style), plus the page's text for teacher notes and alt text. Pages are
 * rendered one at a time to keep memory low on small servers.
 */
export async function renderPdfPages(bytes: Uint8Array, opts: { maxPages?: number; width?: number } = {}): Promise<{ total: number; pages: PdfPage[] }> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const maxPages = opts.maxPages ?? 80;
  const width = opts.width ?? 1600;
  const parser = new PDFParse({ data: Buffer.from(bytes) });
  try {
    const text = await parser.getText();
    const total = text.total ?? text.pages.length;
    const count = Math.min(total, maxPages);
    const pages: PdfPage[] = [];
    for (let n = 1; n <= count; n++) {
      const shot = await parser.getScreenshot({ partial: [n], desiredWidth: width, imageBuffer: true, imageDataUrl: false });
      const png = shot.pages[0];
      if (!png?.data) continue;
      // JPEG on white: a fraction of the PNG's size, and transparent areas don't turn black.
      const img = await loadImage(Buffer.from(png.data));
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, img.width, img.height);
      ctx.drawImage(img, 0, 0);
      const jpeg = await canvas.encode("jpeg", 82);
      const pageText = normalizeText(text.pages.find((p) => p.num === n)?.text ?? "");
      pages.push({ page: n, jpeg, width: img.width, height: img.height, text: pageText });
    }
    return { total, pages };
  } finally {
    await parser.destroy();
  }
}

/**
 * PowerPoint (or Keynote/OpenDocument export) → PDF with LibreOffice, so a deck keeps
 * its design: the PDF then goes through renderPdfPages. Returns null when the server
 * has no LibreOffice (the Docker image installs it; other hosts fall back to text).
 */
export async function officeToPdf(bytes: Uint8Array, ext: string): Promise<Uint8Array | null> {
  const { mkdtemp, writeFile, readFile, rm, access } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const candidates = [process.env.SOFFICE_PATH, "/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/lib/libreoffice/program/soffice",
    "/opt/libreoffice/program/soffice", "C:\\Program Files\\LibreOffice\\program\\soffice.exe"].filter(Boolean) as string[];
  let bin: string | null = null;
  for (const c of candidates) { try { await access(c); bin = c; break; } catch { /* next */ } }
  if (!bin) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "deck-"));
  try {
    const input = path.join(dir, `deck.${ext.replace(/[^a-z]/g, "") || "pptx"}`);
    const output = path.join(dir, "deck.pdf");
    await writeFile(input, bytes);
    // A private profile per conversion, so parallel imports don't share LibreOffice's lock.
    const profile = `file://${dir.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:")}/profile`;
    const started = Date.now();
    const run = () => runOffice(bin!, ["--headless", "--invisible", "--nologo", "--norestore", "--nodefault", "--nolockcheck",
      `-env:UserInstallation=${profile}`, "--convert-to", "pdf", "--outdir", dir, input], dir, OFFICE_TIMEOUT_MS);
    const made = () => access(output).then(() => true, () => false);
    // A brand-new profile makes LibreOffice set itself up and exit (code 81) without
    // converting; the second run converts. Success is judged by the PDF, not the exit code.
    let last = await run();
    if (!(await made()) && last.reason !== "timeout" && last.reason !== "memory") last = await run();
    if (!(await made())) {
      console.error("[lesson-import] LibreOffice conversion failed", { bin, ...last, seconds: Math.round((Date.now() - started) / 1000) });
      throw new Error(`The presentation couldn't be converted: ${officeReason(last)} Saving it as PDF and importing that always works.`);
    }
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const OFFICE_TIMEOUT_MS = 240_000;

type OfficeRun = { reason: "ok" | "timeout" | "memory" | "missing" | "failed"; code: number | string | null; signal: string | null; output: string };

/** Runs LibreOffice and says why it stopped: timed out, killed for memory, couldn't start, or its own error. */
async function runOffice(bin: string, args: string[], home: string, timeout: number): Promise<OfficeRun> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    // Runs an installed program, not a project file: tell the bundler not to trace it.
    execFile(/* turbopackIgnore: true */ bin, args, { timeout, maxBuffer: 1 << 20, env: { ...process.env, HOME: home, TMPDIR: home } },
      (err, stdout, stderr) => {
        const output = `${stdout ?? ""}\n${stderr ?? ""}`.trim().slice(-2000);
        if (!err) return resolve({ reason: "ok", code: 0, signal: null, output });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null; code?: number | string };
        const reason = e.killed ? "timeout" : e.signal === "SIGKILL" ? "memory"
          : e.code === "ENOENT" || e.code === "EACCES" ? "missing" : "failed";
        resolve({ reason, code: e.code ?? null, signal: e.signal ?? null, output });
      });
  });
}

function officeReason(r: OfficeRun): string {
  switch (r.reason) {
    case "timeout": return `the server took longer than ${OFFICE_TIMEOUT_MS / 60_000} minutes (it is too slow: Render's free plan has a tenth of a CPU; use Starter or higher).`;
    case "memory": return "the server ran out of memory (use a plan with more memory, e.g. Standard with 2 GB).";
    case "missing": return "LibreOffice could not be started on this server.";
    default: return `LibreOffice stopped (${r.signal ?? `code ${r.code}`}: ${r.output.split("\n").filter(Boolean).pop() ?? "no details"}).`;
  }
}

const CHECK_DECK = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation">
 <office:body><office:presentation><draw:page draw:name="1">
  <draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>SwiftCipher conversion check</text:p></draw:text-box></draw:frame>
 </draw:page></office:presentation></office:body>
</office:document>`;

/**
 * For the platform console: is LibreOffice installed, how fast does it start here,
 * and what does the server have? Converts a one-line document to PDF.
 */
export async function officeCheck(): Promise<Record<string, unknown>> {
  const { mkdtemp, writeFile, rm, access, stat } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const server = { cpus: os.cpus().length, memory_mb: Math.round(os.totalmem() / 1048576), free_mb: Math.round(os.freemem() / 1048576) };
  const candidates = [process.env.SOFFICE_PATH, "/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/lib/libreoffice/program/soffice",
    "/opt/libreoffice/program/soffice", "C:\\Program Files\\LibreOffice\\program\\soffice.exe"].filter(Boolean) as string[];
  let bin: string | null = null;
  for (const c of candidates) { try { await access(c); bin = c; break; } catch { /* next */ } }
  if (!bin) return { installed: false, server, advice: "LibreOffice is not installed. Use the Docker runtime (render.yaml) so PowerPoint imports keep their design." };
  const dir = await mkdtemp(path.join(os.tmpdir(), "office-check-"));
  try {
    const version = await runOffice(bin, ["--version"], dir, 60_000);
    // A one-slide presentation: the same Impress-to-PDF path a real deck takes.
    const input = path.join(dir, "check.fodp");
    await writeFile(input, CHECK_DECK);
    const profile = `file://${dir.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:")}/profile`;
    const args = ["--headless", "--invisible", "--nologo", "--norestore", "--nodefault", "--nolockcheck", `-env:UserInstallation=${profile}`,
      "--convert-to", "pdf", "--outdir", dir, input];
    const t0 = Date.now();
    let run = await runOffice(bin, args, dir, OFFICE_TIMEOUT_MS);
    const pdf = path.join(dir, "check.pdf");
    let ok = await stat(pdf).then(() => true, () => false);
    if (!ok && run.reason === "failed") { run = await runOffice(bin, args, dir, OFFICE_TIMEOUT_MS); ok = await stat(pdf).then(() => true, () => false); }
    return {
      installed: true, bin, version: version.output.split("\n")[0] ?? null, server,
      conversion: { ok, seconds: Math.round((Date.now() - t0) / 100) / 10, reason: ok ? "ok" : officeReason(run), output: ok ? undefined : run.output }
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
