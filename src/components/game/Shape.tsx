import { Circle, Diamond, Hexagon, Square, Star, Triangle } from "lucide-react";
import { OPTION_SHAPES } from "./types";

const SHAPES = { triangle: Triangle, diamond: Diamond, circle: Circle, square: Square, hexagon: Hexagon, star: Star } as const;

/** The shape that goes with answer tile i (so colour is never the only way to tell answers apart). */
export function OptionShape({ i, className }: { i: number; className?: string }) {
  const S = SHAPES[OPTION_SHAPES[i % OPTION_SHAPES.length]!];
  return <S className={className ?? "h-5 w-5 shrink-0"} fill="currentColor" strokeWidth={0} aria-hidden />;
}
