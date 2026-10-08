"use client";
import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** A QR code that opens the join page with the code filled in. Generated locally (no external service). */
export function JoinQr({ code, className }: { code: string; className?: string }) {
  const svg = useMemo(() => {
    if (typeof window === "undefined" || !code) return "";
    const qr = qrcode(0, "M");
    qr.addData(`${window.location.origin}/join?code=${encodeURIComponent(code)}`);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [code]);
  if (!svg) return null;
  // The markup comes from the QR library for our own URL, never from user input.
  return <div role="img" aria-label="QR code to join" className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}
