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
  const { execFile } = await import("node:child_process");
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
    await writeFile(input, bytes);
    await new Promise<void>((resolve, reject) => {
      // A private profile per conversion: parallel imports don't share LibreOffice's lock.
      // Runs an installed program, not a project file: tell the bundler not to trace it.
      execFile(/* turbopackIgnore: true */ bin!, ["--headless", "--norestore", `-env:UserInstallation=file://${dir.replace(/\\/g, "/")}/profile`,
        "--convert-to", "pdf", "--outdir", dir, input], { timeout: 120_000, maxBuffer: 1 << 20 },
        (err) => (err ? reject(new Error("The presentation couldn't be converted. Try saving it as PDF and importing that.")) : resolve()));
    });
    return new Uint8Array(await readFile(path.join(dir, "deck.pdf")));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
