import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// §18 — Server-rendered PDF/CSV export. CSV is generated inline here; PDF uses
// a minimal hand-rolled PDF generator (text-mode) so no extra npm dep is
// required.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: rep } = await sb.from("reports").select("*").eq("id", params.id).maybeSingle();
  if (!rep) return NextResponse.json({ error: "report not found" }, { status: 404 });
  const format = (rep as { format?: string }).format ?? "csv";
  const payload = (rep as { payload?: Record<string, unknown> }).payload ?? {};

  if (format === "json") {
    return new NextResponse(JSON.stringify({ name: rep.name, kind: rep.kind, payload }, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${rep.name}.json"`
      }
    });
  }

  if (format === "csv") {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(payload)) {
      if (Array.isArray(v)) continue;
      lines.push(`${csv(k)},${csv(stringifyValue(v))}`);
    }
    const tail = payload.last as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(tail) && tail.length) {
      const headers = Array.from(new Set(tail.flatMap((o) => Object.keys(o))));
      lines.push("");
      lines.push(headers.join(","));
      for (const row of tail) lines.push(headers.map((h) => csv(stringifyValue(row[h]))).join(","));
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${rep.name}.csv"`
      }
    });
  }

  if (format === "pdf") {
    const title = `${rep.name} (${rep.kind})`;
    const lines = [
      title,
      "Date: " + new Date().toISOString(),
      "",
      ...Object.entries(payload).flatMap(([k, v]) => {
        if (Array.isArray(v)) return [`# ${k} (${v.length} items)`];
        return [`${k}: ${stringifyValue(v)}`];
      })
    ];
    const pdf = buildSimplePdf(lines);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${rep.name}.pdf"`
      }
    });
  }

  return NextResponse.json({ error: "unsupported format" }, { status: 400 });
}

function csv(s: string): string {
  if (s == null) return "";
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function stringifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function buildSimplePdf(lines: string[]): Uint8Array {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const safe = lines.map((l) => l.replace(/[^\x20-\x7e]/g, "?"));
  const wrapped: string[] = [];
  for (const l of safe) {
    for (let i = 0; i < l.length; i += 80) wrapped.push(l.slice(i, i + 80));
    if (!l.length) wrapped.push("");
  }
  const stream = "BT\n/F1 11 Tf\n50 770 Td\n14 TL\n"
    + wrapped.map((s) => `(${escape(s)}) Tj T*`).join("\n") + "\nET";
  const enc = new TextEncoder();
  const objects: { idx: number; body: Uint8Array }[] = [];
  const push = (body: string) => objects.push({ idx: objects.length + 1, body: enc.encode(body) });

  push("<< /Type /Catalog /Pages 2 0 R >>");
  push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>");
  push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(out.length);
    out += `${o.idx} 0 obj\n${new TextDecoder().decode(o.body)}\nendobj\n`;
  }
  const xrefPos = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${off.toString().padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return enc.encode(out);
}
