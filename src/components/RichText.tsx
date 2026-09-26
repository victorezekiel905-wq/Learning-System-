import { Fragment, type ReactNode } from "react";

/**
 * Minimal, XSS-safe text formatter for slide bodies and prompts. Supports
 * "# heading", "- bullets", "1. numbered", **bold**, *italic*, `code` and
 * [links](https://…). Output is React elements only — no HTML injection.
 */
export function RichText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, i) => <Block key={i} block={block} />)}
    </div>
  );
}

function Block({ block }: { block: string }) {
  const lines = block.split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return null;
  const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0]!);
  if (heading && lines.length === 1) {
    const level = heading[1]!.length;
    const cls = level === 1 ? "text-2xl font-bold" : level === 2 ? "text-xl font-semibold" : "text-lg font-semibold";
    return <p className={`${cls} mb-2`}>{inline(heading[2]!)}</p>;
  }
  if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
    return <ul className="mb-3 list-disc space-y-1 pl-6">{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>)}</ul>;
  }
  if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
    return <ol className="mb-3 list-decimal space-y-1 pl-6">{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>)}</ol>;
  }
  return (
    <p className="mb-3 leading-relaxed">
      {lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}
    </p>
  );
}

// Links: https?:// or a same-site path ("/x", never "//other-site").
const TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|\/(?!\/))[^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(TOKEN).filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-ink-100 px-1 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(((?:https?:\/\/|\/(?!\/))[^)\s]+)\)$/.exec(part);
    if (link) {
      const external = link[2]!.startsWith("http");
      return <a key={i} href={link[2]} className="underline" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{link[1]}</a>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
