import type { QuestionKind } from "./types";

/*
 * Turns questions typed or pasted the way teachers write them (an exam paper, a
 * worksheet, a spreadsheet) into questions ready to save. Numbering and option
 * letters in the source are dropped: questions are numbered in the order they
 * come, and options keep their order.
 *
 *   1. What is the capital of Nigeria?
 *   A. Lagos
 *   B. Abuja
 *   C. Kano
 *   Answer: B
 *
 * The right option can also be marked with * or (correct), or in a Word file by
 * making it bold, underlined, highlighted or coloured. Optional lines: Type:,
 * Topic:, Points:, Explanation:.
 */

export type ImportedOption = { label: string; is_correct: boolean };
export type ImportedQuestion = {
  kind: QuestionKind;
  prompt: string;
  points: number;
  explanation: string | null;
  topic: string | null;
  options: ImportedOption[];
  config: Record<string, unknown>;
  answer_key: Record<string, unknown>;
  /** Why it can't be added yet; the teacher fixes the text and it is read again. */
  problem?: string;
  /** With a problem: the question's lines as written (without its number). */
  source?: string;
};

/** Marks text that was bold, underlined, highlighted or coloured in a Word file. */
export const MARK = "\uE000";
const MARKS = new RegExp(MARK, "g");

const TYPE_WORDS: [RegExp, QuestionKind][] = [
  [/^(true\s*(\/|or|-)\s*false|t\s*\/\s*f|tf|true_false)$/, "true_false"],
  [/(select all|multi|several|checkbox|more than one)/, "multi_select"],
  [/(multiple choice|mcq|objective|single|choice)/, "mcq"],
  [/(poll|survey|vote|opinion)/, "poll"],
  [/(blank|fill|gap|cloze)/, "fill_blank"],
  [/(match|pair)/, "matching"],
  [/(order|sequence|arrange|rank)/, "ordering"],
  [/(group|sort|categor|classif)/, "categorize"],
  [/(short|structured|rubric)/, "short"],
  [/(open|essay|theory|discuss|written|explain)/, "open"],
  [/(draw|sketch|annotate|label)/, "draw"],
  [/(code|program)/, "code"],
  [/(file|upload|submission)/, "file"]
];

export const IMPORT_KIND_NAME: Record<QuestionKind, string> = {
  mcq: "multiple choice", multi_select: "select all that apply", true_false: "true / false", poll: "poll",
  open: "open-ended", short: "short answer", fill_blank: "fill in the blanks", matching: "matching pairs",
  ordering: "put in order", categorize: "sort into groups", draw: "drawing", file: "file upload", code: "code"
};

// "1.", "1)", "Q1.", "Question 1:" and "1.What…", but not "1.5 litres".
const QUESTION_START = /^\s*(?:q(?:uestion|n|s)?\.?\s*)?(\d{1,3})\s*(?:[.)]|:)(?:\s+|$|(?=[A-Za-z("“'‘]))(.*)$/i;
const OPTION = /^\s*(?:\(\s*([a-h])\s*\)|([a-h])\s*[.)\]:])\s*(.*)$/i;
const NOT_OPTION = /^\s*(e\.g\.|i\.e\.|a\.m\.|b\.sc|b\.a\.)/i;
const BULLET = /^\s*(?:[-•▪◦●○➢>]|\[\s*[xX✓✔]?\s*\])\s+(.*)$/;
const CHECKED = /^\s*\[\s*[xX✓✔]\s*\]/;
const META = /^\s*(answers?|ans|correct answers?|correct|key|solution|type|question type|kind|topic|subject topic|points?|marks?|score|explanation|reason|why|feedback)\s*[:=\-–]\s*(.*)$/i;
const PAIR = /^(.+?)\s*(?:=>|->|→|↔|⟷|=)\s*(.+)$/;

type Block = {
  prompt: string[];
  options: { label: string; marked: boolean; formatted: boolean }[];
  pairs: [string, string][];
  extra: string[];
  answer: string[];
  type: string | null;
  topic: string | null;
  points: number | null;
  explanation: string | null;
  gap: boolean;
  numbered: boolean;
  /** Its lines as written. */
  raw: string[];
};

const empty = (): Block => ({ prompt: [], options: [], pairs: [], extra: [], answer: [], type: null, topic: null, points: null, explanation: null, gap: false, numbered: false, raw: [] });
const has = (b: Block) => b.prompt.length > 0 || b.options.length > 0 || b.answer.length > 0;
const plain = (s: string) => s.replace(MARKS, "").replace(/\s+/g, " ").trim();

/** A line holding several options, like "A. 2   B. 4   C. 6   D. 8". */
function inlineOptions(line: string): string[] | null {
  const re = /(^|\s)\(?([a-h])[.)]\s/gi;
  const hits: { at: number; letter: string; end: number }[] = [];
  for (let m = re.exec(line); m; m = re.exec(line)) hits.push({ at: m.index + m[1]!.length, letter: m[2]!.toLowerCase(), end: m.index + m[0].length });
  if (hits.length < 2 || hits[0]!.at !== line.search(/\S/)) return null;
  if (!hits.every((h, i) => h.letter === String.fromCharCode(97 + i))) return null;
  return hits.map((h, i) => line.slice(h.end, hits[i + 1]?.at ?? line.length).trim());
}

function optionText(raw: string) {
  let text = raw;
  let marked = false;
  if (CHECKED.test(text)) marked = true;
  text = text.replace(/^\s*\[\s*[xX✓✔]?\s*\]\s*/, "");
  const formatted = text.includes(MARK);
  text = text.replace(MARKS, "");
  if (/^\s*\*/.test(text) || /(\*|✓|✔|\((?:correct|answer|right)\)|\[(?:correct|answer|right)\])\s*$/i.test(text)) marked = true;
  text = text.replace(/^\s*\*\s*/, "").replace(/\s*(\*+|✓|✔|\((?:correct|answer|right)\)|\[(?:correct|answer|right)\])\s*$/i, "");
  return { label: plain(text), marked, formatted };
}

/** paragraphs: each line is a whole paragraph (a Word file), so a line never continues an option. */
function splitBlocks(text: string, paragraphs = false): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ").replace(/[\u00a0\u200b\u2060\ufeff]/g, " ").split("\n");
  const blocks: Block[] = [];
  let b = empty();
  const flush = () => { if (has(b)) blocks.push(b); b = empty(); };

  // Places one line in the current question (starting a new one when needed).
  const place = (line: string, bare: string) => {
    const start = QUESTION_START.exec(line);
    if (start) {
      // Numbered items under "Type: Order" are the items, not new questions.
      if (b.type && /order|sequence|arrange|rank/i.test(b.type) && b.prompt.length && !b.answer.length && !b.gap) {
        const o = optionText(start[2]!);
        if (o.label) b.options.push(o);
        return;
      }
      const pending = has(b) ? null : b.type;
      flush();
      b.type = pending;
      if (pending) b.raw.push(`Type: ${pending}`);
      b.numbered = true;
      if (plain(start[2]!)) b.prompt.push(start[2]!);
      return;
    }

    const meta = META.exec(bare);
    if (meta && (has(b) || /^(type|question type|kind)$/i.test(meta[1]!))) {
      const key = meta[1]!.toLowerCase(), value = meta[2]!.trim();
      if (/^(answers?|ans|correct answers?|correct|key|solution)$/.test(key)) b.answer.push(value);
      else if (/type|kind/.test(key)) b.type = value;
      else if (/topic/.test(key)) b.topic = value.slice(0, 60) || null;
      else if (/^(points?|marks?|score)$/.test(key)) { const n = Number.parseFloat(value); b.points = Number.isFinite(n) ? n : null; }
      else b.explanation = value || null;
      b.gap = false;
      return;
    }

    const several = inlineOptions(line);
    if (several && has(b)) {
      for (const o of several) b.options.push(optionText(o));
      b.gap = false;
      return;
    }
    const opt = NOT_OPTION.test(line) ? null : OPTION.exec(line);
    const bullet = opt ? null : BULLET.exec(line);
    if ((opt || bullet) && b.prompt.length) {
      const body = opt ? opt[3]! : line;
      const o = optionText(opt ? body : line.replace(/^\s*[-•▪◦●○➢>]\s+/, ""));
      if (o.label) b.options.push(o);
      b.gap = false;
      return;
    }

    // An unnumbered question: after the answer line, after a blank line once the one
    // before has options, or straight after the options when the line is a question
    // (ends in "?", has a blank to fill) or the text is a Word file's paragraphs.
    if (b.answer.length || (b.gap && (b.options.length || b.pairs.length || b.extra.length))
      || (b.options.length && (paragraphs || /\?\s*$/.test(bare) || /_{3,}|\.{4,}|…{2,}/.test(bare)))) flush();

    if (b.prompt.length && !b.options.length) {
      const pair = PAIR.exec(bare);
      if (pair && !/_{3,}/.test(bare)) { b.pairs.push([pair[1]!.trim(), pair[2]!.trim()]); b.extra.push(bare); b.gap = false; return; }
      const list = ["matching", "ordering", "categorize"].includes(kindFromType(b.type) ?? "");
      if (b.gap || b.pairs.length || list) { b.extra.push(bare); b.gap = false; return; }
    }
    if (b.options.length && !b.gap) {
      // A wrapped option continues on the next line.
      const last = b.options[b.options.length - 1]!;
      last.label = `${last.label} ${bare}`.trim();
      return;
    }
    if (b.gap && b.options.length) flush();
    b.prompt.push(line);
    b.gap = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const bare = plain(line);
    if (!bare) { b.gap = true; continue; }
    const before = b;
    place(line, bare);
    // The line as written, without the number of a question it starts.
    const numbered = b !== before ? QUESTION_START.exec(line) : null;
    b.raw.push(plain(numbered ? numbered[2]! : line));
  }
  flush();
  // When questions are numbered, a title or instructions above the first one aren't questions.
  const first = blocks.findIndex((x) => x.numbered);
  if (first > 0) return [...blocks.slice(0, first).filter((x) => x.options.length || x.answer.length || x.pairs.length), ...blocks.slice(first)];
  return blocks;
}

function kindFromType(type: string | null): QuestionKind | null {
  if (!type) return null;
  const t = type.trim().toLowerCase();
  for (const [re, kind] of TYPE_WORDS) if (re.test(t)) return kind;
  return null;
}

const isTrue = (s: string) => /^(true|t|yes|correct|right)$/i.test(s.trim().replace(/[.!]$/, ""));
const isFalse = (s: string) => /^(false|f|no|wrong|incorrect)$/i.test(s.trim().replace(/[.!]$/, ""));

/** Which options an "Answer:" line names: letters ("B", "B and D", "(b)") or the option's own words. */
function answerOptions(answer: string, options: string[]): number[] | null {
  const raw = answer.replace(/^(option|options|letter)\s+/i, "").trim().replace(/[.]$/, "");
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const want = norm(raw);
  const letters = raw.replace(/[()[\]]/g, "");
  // "B" and "B, D" are option letters; a run like "bad" is checked against the options' words first.
  const separated = /^[a-h](\s*(,|&|\band\b|\s)\s*[a-h])*$/i.test(letters);
  const exact = options.findIndex((o) => norm(o) === want);
  if (exact >= 0 && !separated) return [exact];
  if (separated || /^[a-h]{2,8}$/i.test(letters)) {
    const picked = letters.toLowerCase().match(/\b[a-h]\b|^[a-h]$/g) ?? letters.toLowerCase().replace(/[^a-h]/g, "").split("");
    return [...new Set(picked.map((l) => l.charCodeAt(0) - 97))];
  }
  const lead = /^\(?([a-h])[.)]\s+(.+)$/i.exec(raw);
  if (lead) return [lead[1]!.toLowerCase().charCodeAt(0) - 97];
  const parts = raw.split(/\s*(?:,|;|\band\b)\s*/i).map(norm).filter(Boolean);
  if (parts.length > 1) {
    const found = parts.map((p) => options.findIndex((o) => norm(o) === p));
    if (found.every((i) => i >= 0)) return found;
  }
  return null;
}

let seq = 0;
const id = (prefix: string) => `${prefix}${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}`;

function build(b: Block, allowed: QuestionKind[]): ImportedQuestion {
  // Dotted gaps ("The capital is ........") become blanks.
  const lines = (list: string[]) => list.map((l) => l.replace(MARKS, "").replace(/(?:\.{4,}|…{2,}|_{3,})/g, "___").trim()).join("\n").trim();
  let prompt = lines(b.prompt);
  const options = b.options.map((o) => ({ ...o, label: o.label.slice(0, 1000) }));
  const labels = options.map((o) => o.label);
  const answer = b.answer.join("; ").trim();
  let kind = kindFromType(b.type);

  if (!kind) {
    if (options.length) {
      const tf = options.length === 2 && isTrue(labels[0]!) && isFalse(labels[1]!);
      const explicit = answer ? answerOptions(answer, labels) : null;
      const marked = options.filter((o) => o.marked).length;
      kind = tf ? "true_false" : (explicit?.length ?? marked) > 1 ? "multi_select" : "mcq";
      if (!answer && !marked && !options.some((o) => o.formatted) && allowed.includes("poll") && !allowed.includes("mcq")) kind = "poll";
    } else if (/_{3,}/.test(prompt)) kind = "fill_blank";
    else if (answer && (isTrue(answer) || isFalse(answer))) kind = "true_false";
    else if (b.pairs.length >= 2 && allowed.includes("matching")) kind = "matching";
    else kind = "open";
  }
  // Lines like "2x + 3 = 7" belong to the question unless it is a matching or sorting one.
  if (b.extra.length && kind !== "matching" && kind !== "categorize" && !(kind === "ordering" && !labels.length)) prompt = lines([...b.prompt, ...b.extra]);
  prompt = prompt.slice(0, 4000);

  // Fit the question to what this slide holds.
  if (!allowed.includes(kind)) {
    if ((kind === "mcq" || kind === "multi_select" || kind === "true_false") && allowed.includes("poll")) kind = "poll";
    else if (kind === "mcq" && allowed.includes("multi_select")) kind = "multi_select";
    else if (kind === "open" && allowed.includes("short")) kind = "short";
    else if (kind === "short" && allowed.includes("open")) kind = "open";
    else if (kind === "open" && allowed.length === 1 && ["draw", "file", "code"].includes(allowed[0]!)) kind = allowed[0]!;
  }

  const q: ImportedQuestion = {
    kind, prompt, explanation: b.explanation, topic: b.topic, options: [], config: {}, answer_key: {},
    points: b.points ?? (kind === "poll" ? 0 : kind === "short" || kind === "code" ? 5 : 1)
  };
  // A question that needs a fix keeps its lines as written, so tidying a file never loses them.
  const fail = (problem: string) => { q.problem = problem; q.source = b.raw.join("\n"); return q; };

  if (!prompt) return fail("The question itself is missing.");
  if (!allowed.includes(kind)) {
    return fail(`This looks like ${IMPORT_KIND_NAME[kind]}, but this slide takes ${allowed.map((k) => IMPORT_KIND_NAME[k]).join(", ")} questions.`);
  }

  if (kind === "mcq" || kind === "multi_select" || kind === "true_false" || kind === "poll") {
    let opts = labels;
    if (kind === "true_false" && !opts.length) opts = ["True", "False"];
    if (opts.length < 2) return fail("Add at least two options (A, B, C…), each on its own line.");
    if (opts.length > 8) return fail(`A question can have up to 8 options; this one has ${opts.length}.`);
    let correct: number[] = [];
    if (kind === "true_false" && (isTrue(answer) || isFalse(answer))) {
      const t = opts.findIndex((o) => isTrue(o)), f = opts.findIndex((o) => isFalse(o));
      correct = isTrue(answer) ? [t >= 0 ? t : 0] : [f >= 0 ? f : 1];
    } else if (answer) {
      const picked = answerOptions(answer, opts);
      if (!picked && kind !== "poll") return fail(`"Answer: ${answer}" doesn't match any option. Use the letter, e.g. Answer: B.`);
      correct = (picked ?? []).filter((i) => i < opts.length);
      if (picked && correct.length < picked.length && kind !== "poll") return fail(`"Answer: ${answer}" names an option that isn't there.`);
    } else {
      correct = options.flatMap((o, i) => (o.marked ? [i] : []));
      if (!correct.length) {
        // Word formatting counts only when it singles out some options, not all of them.
        const styled = options.flatMap((o, i) => (o.formatted ? [i] : []));
        if (styled.length && styled.length < options.length) correct = styled;
      }
    }
    q.options = opts.map((label, i) => ({ label, is_correct: kind !== "poll" && correct.includes(i) }));
    if (kind === "poll") return q;
    if (kind === "mcq" && correct.length > 1) q.kind = "multi_select";
    if (!correct.length) return fail("Say which option is right: add a line like \"Answer: B\", or put * after it.");
    if (kind === "true_false" && correct.length !== 1) return fail("A true / false question has one right answer.");
    return q;
  }

  if (kind === "fill_blank") {
    const n = (prompt.match(/_{3,}/g) ?? []).length;
    if (!n) return fail("Mark each blank with ___ (three underscores).");
    const given = b.answer.length > 1 ? b.answer : answer.split(/\s*;\s*/);
    const blanks = given.map((a) => a.split("|").map((s) => s.trim()).filter(Boolean)).filter((a) => a.length);
    if (blanks.length < n) return fail(n === 1 ? "Add the answer, e.g. \"Answer: Abuja\"." : `Add an answer for each of the ${n} blanks, separated by ; (e.g. Answer: Abuja; Lagos).`);
    q.answer_key = { blanks: blanks.slice(0, n) };
    return q;
  }

  if (kind === "matching") {
    const pairs = b.pairs.length ? b.pairs : labels.map((l) => PAIR.exec(l)).filter(Boolean).map((m) => [m![1]!.trim(), m![2]!.trim()] as [string, string]);
    if (pairs.length < 2) return fail("Write each pair on its own line, like \"Lion = Mammal\".");
    const left = pairs.map(([l], i) => ({ id: `l${i + 1}`, label: l })), right = pairs.map(([, r], i) => ({ id: `r${i + 1}`, label: r }));
    q.config = { left, right };
    q.answer_key = { pairs: Object.fromEntries(left.map((l, i) => [l.id, right[i]!.id])) };
    return q;
  }

  if (kind === "ordering") {
    const items = labels.length ? labels : b.extra;
    if (items.length < 2) return fail("List the items in the right order, each on its own line (A, B, C… or - bullets).");
    q.config = { items: items.map((label) => ({ id: id("i"), label })) };
    return q;
  }

  if (kind === "categorize") {
    const lines = [...b.extra, ...labels];
    const cats: { id: string; label: string }[] = [], items: { id: string; label: string }[] = [], placements: Record<string, string> = {};
    for (const line of lines) {
      const m = /^([^:]{1,60}):\s*(.+)$/.exec(line);
      if (!m) continue;
      const cat = { id: `c${cats.length + 1}`, label: m[1]!.trim() };
      cats.push(cat);
      for (const label of m[2]!.split(/\s*[,;]\s*/).filter(Boolean)) { const it = { id: id("i"), label }; items.push(it); placements[it.id] = cat.id; }
    }
    if (cats.length < 2 || !items.length) return fail("Write each group on its own line with its items, like \"Mammals: lion, whale, bat\".");
    q.config = { categories: cats, items };
    q.answer_key = { placements };
    return q;
  }

  // Open, short answer, drawing, file and code questions need only the prompt.
  if (kind === "code") q.config = { language: "javascript", starter: "", tests: [] };
  if (answer && (kind === "open" || kind === "short")) q.explanation = q.explanation ?? `Expected answer: ${answer}`;
  return q;
}

/** Reads every question in the text, for a slide that holds the given kinds. */
export function parseQuestions(text: string, allowed: QuestionKind[], opts: { paragraphs?: boolean } = {}): ImportedQuestion[] {
  return splitBlocks(text, opts.paragraphs).map((b) => build(b, allowed));
}

const TYPE_LINE: Partial<Record<QuestionKind, string>> = {
  poll: "Poll", matching: "Matching", ordering: "Order", categorize: "Groups", short: "Short answer", draw: "Draw", file: "File upload", code: "Code"
};

/**
 * Questions written back out in the importer's own format: numbered, options
 * lettered, the answer on its own line. A Word file is shown this way, so the
 * teacher sees (and can correct) what was read, bold or coloured answers included.
 */
export function questionsToText(qs: ImportedQuestion[]): string {
  return qs.map((q, n) => {
    if (q.problem && q.source) return `${n + 1}. ${q.source}`;
    const out = [`${n + 1}. ${q.prompt}`];
    if (TYPE_LINE[q.kind]) out.push(`Type: ${TYPE_LINE[q.kind]}`);
    const letter = (i: number) => String.fromCharCode(65 + i);
    if (["mcq", "multi_select", "true_false", "poll"].includes(q.kind)) {
      out.push(...q.options.map((o, i) => `${letter(i)}. ${o.label}`));
      const right = q.options.flatMap((o, i) => (o.is_correct ? [letter(i)] : []));
      if (right.length) out.push(`Answer: ${right.join(", ")}`);
    } else if (q.kind === "fill_blank") {
      const blanks = (q.answer_key.blanks as string[][] | undefined) ?? [];
      if (blanks.length) out.push(`Answer: ${blanks.map((b) => b.join(" | ")).join("; ")}`);
    } else if (q.kind === "matching") {
      const left = (q.config.left as { id: string; label: string }[]) ?? [], right = (q.config.right as { id: string; label: string }[]) ?? [];
      out.push(...left.map((l, i) => `${l.label} = ${right[i]?.label ?? ""}`));
    } else if (q.kind === "ordering") {
      out.push(...((q.config.items as { label: string }[]) ?? []).map((it, i) => `${letter(i)}. ${it.label}`));
    } else if (q.kind === "categorize") {
      const cats = (q.config.categories as { id: string; label: string }[]) ?? [], items = (q.config.items as { id: string; label: string }[]) ?? [];
      const at = (q.answer_key.placements as Record<string, string>) ?? {};
      out.push(...cats.map((c) => `${c.label}: ${items.filter((it) => at[it.id] === c.id).map((it) => it.label).join(", ")}`));
    }
    const fallback = q.kind === "poll" ? 0 : q.kind === "short" || q.kind === "code" ? 5 : 1;
    if (q.topic) out.push(`Topic: ${q.topic}`);
    if (q.points !== fallback) out.push(`Points: ${q.points}`);
    if (q.explanation) out.push(`Explanation: ${q.explanation}`);
    return out.join("\n");
  }).join("\n\n");
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/**
 * A spreadsheet (header row first) as question text. Columns: Question; Option A…H
 * (or A, B, C… or one "Options" column split by |); Answer; and optionally Type,
 * Topic, Points, Explanation. Without a recognised header: question, options, answer.
 */
export function tableToText(rows: string[][]): string {
  if (!rows.length) return "";
  const header = rows[0]!.map(norm);
  const at = (names: RegExp) => header.findIndex((h) => names.test(h));
  const iQ = at(/^(question|questions|prompt|question_text|stem|item)$/);
  const out: string[] = [];
  if (iQ < 0) {
    rows.forEach((r, n) => {
      const cells = r.map((c) => c.trim());
      const [q, ...rest] = cells;
      if (!q) return;
      const last = rest.length > 2 ? rest[rest.length - 1]! : "";
      const opts = last && (/^[a-h]$/i.test(last) || rest.slice(0, -1).some((o) => o.toLowerCase() === last.toLowerCase())) ? rest.slice(0, -1) : rest;
      out.push(`${n + 1}. ${q}`, ...opts.filter(Boolean).map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`), ...(opts.length < rest.length ? [`Answer: ${last}`] : []), "");
    });
    return out.join("\n");
  }
  const optCols = header.flatMap((h, i) => (/^(option_?[a-h1-8]|choice_?[a-h1-8]|answer_?[a-h1-8]|[a-h])$/.test(h) ? [i] : []));
  const iOpts = at(/^(options|choices|answers_list)$/);
  const iAns = at(/^(answer|answers|correct|correct_answer|correct_option|key|answer_key|solution)$/);
  const iType = at(/^(type|question_type|kind|format)$/);
  const iTopic = at(/^(topic|subtopic|sub_topic)$/);
  const iPts = at(/^(points|point|marks|mark|score)$/);
  const iExp = at(/^(explanation|reason|feedback|why)$/);
  let n = 0;
  for (const r of rows.slice(1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const q = cell(iQ);
    if (!q) continue;
    n++;
    const opts = optCols.length ? optCols.map(cell).filter(Boolean) : cell(iOpts).split(/\s*[|\n]\s*/).filter(Boolean);
    out.push(`${n}. ${q}`);
    if (cell(iType)) out.push(`Type: ${cell(iType)}`);
    out.push(...opts.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`));
    if (cell(iAns)) out.push(`Answer: ${cell(iAns)}`);
    if (cell(iTopic)) out.push(`Topic: ${cell(iTopic)}`);
    if (cell(iPts)) out.push(`Points: ${cell(iPts)}`);
    if (cell(iExp)) out.push(`Explanation: ${cell(iExp)}`);
    out.push("");
  }
  return out.join("\n");
}

/** An example in the format the importer reads, for the kinds a slide holds. */
export function importExample(allowed: QuestionKind[]): string {
  const parts: string[] = [];
  if (allowed.includes("mcq")) parts.push("1. What is the capital of Nigeria?\nA. Lagos\nB. Abuja\nC. Kano\nD. Ibadan\nAnswer: B\nTopic: Geography");
  if (allowed.includes("multi_select")) parts.push(`${parts.length + 1}. Which of these are prime numbers?\nA. 2\nB. 4\nC. 7\nD. 9\nAnswer: A, C`);
  if (allowed.includes("true_false")) parts.push(`${parts.length + 1}. Water boils at 100 °C at sea level.\nAnswer: True`);
  if (allowed.includes("poll") && !allowed.includes("mcq")) parts.push("1. Which topic should we revise first?\nA. Fractions\nB. Decimals\nC. Percentages");
  if (allowed.includes("fill_blank")) parts.push(`${parts.length + 1}. The chemical symbol for water is ___.\nAnswer: H2O`);
  if (allowed.includes("matching")) parts.push(`${parts.length + 1}. Match each animal to its group.\nType: Matching\nLion = Mammal\nEagle = Bird\nShark = Fish`);
  if (allowed.includes("ordering")) parts.push(`${parts.length + 1}. Put these in order, smallest first.\nType: Order\nA. Atom\nB. Cell\nC. Organ\nD. Body`);
  if (allowed.includes("categorize")) parts.push(`${parts.length + 1}. Sort these numbers.\nType: Groups\nEven: 2, 4, 8\nOdd: 3, 5, 9`);
  if (allowed.includes("open") || allowed.includes("short")) parts.push(`${parts.length + 1}. Explain why the sky looks blue.`);
  if (!parts.length && allowed.length) parts.push(`1. ${allowed.includes("draw") ? "Draw and label a plant cell." : allowed.includes("code") ? "Write a function that adds two numbers." : "Upload a photo of your model."}`);
  return parts.join("\n\n");
}
