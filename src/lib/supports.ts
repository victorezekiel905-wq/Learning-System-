"use client";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";

/** Learning supports a teacher set privately for this student (migration 0800). */
export type Supports = { read_aloud: boolean; readable_font: boolean; extra_time_pct: 0 | 25 | 50 | 100; calm_mode: boolean };

const NONE: Supports = { read_aloud: false, readable_font: false, extra_time_pct: 0, calm_mode: false };
let cached: Promise<Supports> | null = null;

/** The signed-in student's supports; fetched once per page load and shared. Staff get none. */
export function useSupports(enabled = true): Supports {
  const [s, setS] = useState<Supports>(NONE);
  useEffect(() => {
    if (!enabled) return;
    cached ??= rpc<Supports>("my_supports").catch(() => NONE);
    let live = true;
    void cached.then((v) => live && setS(v ?? NONE));
    return () => { live = false; };
  }, [enabled]);
  return s;
}

/** Call after a teacher changes supports in this tab, so the next read is fresh. */
export function forgetSupports() { cached = null; }
