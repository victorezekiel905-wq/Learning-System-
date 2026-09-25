"use client";
import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

// Last-resort boundary (the root layout itself failed), so no app styles are assumed.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError(error, error.digest ? `root digest=${error.digest}` : "root"); }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 24 }}>SwiftCipher is having trouble</h1>
          <p style={{ color: "#54514A" }}>The problem has been reported automatically.</p>
          {error.digest && <p style={{ fontFamily: "monospace", fontSize: 12, color: "#6B675E" }}>Reference: {error.digest}</p>}
          <button onClick={reset} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, border: 0, background: "#151411", color: "#fff", fontWeight: 600 }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
