"use client";
import { useEffect, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Strips the light markup used in prompts so the voice reads words, not symbols. */
const plain = (t: string) => t.replace(/[*_`#>]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Reads text aloud with the device's own voice (no audio leaves the device).
 * Offered on every question; highlighted for students whose teacher turned on
 * the read-aloud support.
 */
export function ReadAloud({ text, emphasis, className }: { text: string; emphasis?: boolean; className?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported, text]);
  if (!supported) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(plain(text));
    u.lang = document.documentElement.lang || "en";
    u.rate = 0.95;
    u.onend = u.onerror = () => setSpeaking(false);
    synth.speak(u);
    setSpeaking(true);
  }

  return (
    <button type="button" onClick={toggle} aria-pressed={speaking}
      className={cn("btn btn-sm shrink-0", emphasis ? "btn-accent" : "btn-secondary", className)}>
      {speaking ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
      {speaking ? "Stop" : "Read aloud"}
    </button>
  );
}
