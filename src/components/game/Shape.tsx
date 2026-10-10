import { Cloud, Heart, Hexagon, Moon, Star, Zap } from "lucide-react";
import { OPTION_SHAPES } from "./types";

const SHAPES = { bolt: Zap, star: Star, hexagon: Hexagon, moon: Moon, heart: Heart, cloud: Cloud } as const;

/** The shape that goes with answer tile i (so colour is never the only way to tell answers apart). */
export function OptionShape({ i, className }: { i: number; className?: string }) {
  const S = SHAPES[OPTION_SHAPES[i % OPTION_SHAPES.length]!];
  return <S className={className ?? "h-5 w-5 shrink-0"} fill="currentColor" strokeWidth={0} aria-hidden />;
}
