import { cn } from "@/lib/utils";

/*
 * SwiftCipher's characters: flat, geometric animals in the answer-tile colours,
 * drawn as SVG so they look the same on every phone, tablet and projector
 * (emoji differ between Apple, Android and Windows). Keys match the stored
 * avatar words (see avatars.ts); unknown or missing keys get the default face.
 */

const INK = "#151411";
const WHITE = "#FFFFFF";

/** Two eyes and a smile, shared by every character. */
function Face({ y = 34, gap = 11, mouth = true, eye = 4.2, mouthY }: { y?: number; gap?: number; mouth?: boolean; eye?: number; mouthY?: number }) {
  return (
    <g>
      <circle cx={32 - gap} cy={y} r={eye} fill={INK} />
      <circle cx={32 + gap} cy={y} r={eye} fill={INK} />
      <circle cx={32 - gap + 1.4} cy={y - 1.5} r={1.3} fill={WHITE} />
      <circle cx={32 + gap + 1.4} cy={y - 1.5} r={1.3} fill={WHITE} />
      {mouth && <path d={`M27 ${mouthY ?? y + 9} q5 4.5 10 0`} stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none" />}
    </g>
  );
}

const ART: Record<string, React.ReactNode> = {
  fox: <>
    <path d="M10 8 L26 22 L14 30 Z M54 8 L38 22 L50 30 Z" fill="#C2410C" />
    <path d="M14 13 L22 21 L16 25 Z M50 13 L42 21 L48 25 Z" fill="#FDBA74" />
    <path d="M8 26 Q32 4 56 26 L52 44 Q32 62 12 44 Z" fill="#E8590C" />
    <path d="M18 42 Q32 60 46 42 Q40 50 32 50 Q24 50 18 42 Z" fill={WHITE} />
    <Face y={34} gap={11} mouth={false} />
    <path d="M29 44 h6 l-3 3.5 z" fill={INK} />
  </>,
  owl: <>
    <path d="M12 8 L22 18 L12 22 Z M52 8 L42 18 L52 22 Z" fill="#4C1D95" />
    <rect x="9" y="14" width="46" height="44" rx="20" fill="#6D28D9" />
    <circle cx="22" cy="32" r="10" fill={WHITE} /><circle cx="42" cy="32" r="10" fill={WHITE} />
    <Face y={32} gap={10} mouth={false} eye={4.6} />
    <path d="M28 41 L36 41 L32 48 Z" fill="#F59E0B" />
  </>,
  panda: <>
    <circle cx="14" cy="14" r="8" fill={INK} /><circle cx="50" cy="14" r="8" fill={INK} />
    <circle cx="32" cy="34" r="25" fill="#F6F5F1" />
    <ellipse cx="21" cy="32" rx="7" ry="8.5" transform="rotate(-20 21 32)" fill={INK} />
    <ellipse cx="43" cy="32" rx="7" ry="8.5" transform="rotate(20 43 32)" fill={INK} />
    <circle cx="21.5" cy="32" r="3" fill={WHITE} /><circle cx="42.5" cy="32" r="3" fill={WHITE} />
    <ellipse cx="32" cy="42" rx="3.6" ry="2.6" fill={INK} />
    <path d="M28 46 q4 3.5 8 0" stroke={INK} strokeWidth={2.4} strokeLinecap="round" fill="none" />
  </>,
  tiger: <>
    <circle cx="14" cy="15" r="7" fill="#EA8A0C" /><circle cx="50" cy="15" r="7" fill="#EA8A0C" />
    <rect x="8" y="12" width="48" height="46" rx="21" fill="#F59E0B" />
    <path d="M32 12 v8 M25 13 l2 7 M39 13 l-2 7 M8 32 h7 M8 38 h6 M56 32 h-7 M56 38 h-6" stroke={INK} strokeWidth={3} strokeLinecap="round" />
    <ellipse cx="32" cy="45" rx="11" ry="8" fill="#FEF3C7" />
    <Face y={33} gap={11} mouth={false} />
    <path d="M29 42 h6 l-3 3 z" fill={INK} />
  </>,
  frog: <>
    <circle cx="19" cy="17" r="10" fill="#C6EE3A" /><circle cx="45" cy="17" r="10" fill="#C6EE3A" />
    <ellipse cx="32" cy="38" rx="27" ry="21" fill="#C6EE3A" />
    <circle cx="19" cy="17" r="6.5" fill={WHITE} /><circle cx="45" cy="17" r="6.5" fill={WHITE} />
    <circle cx="19" cy="18" r="3.6" fill={INK} /><circle cx="45" cy="18" r="3.6" fill={INK} />
    <path d="M18 40 q14 12 28 0" stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" />
    <circle cx="14" cy="36" r="3" fill="#F472B6" opacity=".7" /><circle cx="50" cy="36" r="3" fill="#F472B6" opacity=".7" />
  </>,
  koala: <>
    <circle cx="12" cy="22" r="11" fill="#8B8578" /><circle cx="52" cy="22" r="11" fill="#8B8578" />
    <circle cx="12" cy="22" r="6" fill="#F9A8D4" /><circle cx="52" cy="22" r="6" fill="#F9A8D4" />
    <circle cx="32" cy="36" r="23" fill="#A29D91" />
    <Face y={31} gap={10} mouth={false} />
    <ellipse cx="32" cy="42" rx="6" ry="7.5" fill={INK} />
  </>,
  penguin: <>
    <rect x="9" y="6" width="46" height="54" rx="22" fill="#1E3A8A" />
    <path d="M14 30 Q20 14 32 22 Q44 14 50 30 Q52 52 32 56 Q12 52 14 30 Z" fill={WHITE} />
    <Face y={32} gap={9} mouth={false} />
    <path d="M27 40 L37 40 L32 47 Z" fill="#F59E0B" />
  </>,
  lion: <>
    <path d="M32 2 L58 17 L58 47 L32 62 L6 47 L6 17 Z" fill="#B45309" />
    <circle cx="32" cy="33" r="19" fill="#F5B83D" />
    <ellipse cx="32" cy="42" rx="9" ry="7" fill="#FDE68A" />
    <Face y={31} gap={8.5} mouth={false} eye={3.8} />
    <path d="M29 39 h6 l-3 3 z" fill={INK} />
  </>,
  rabbit: <>
    <rect x="15" y="1" width="11" height="30" rx="5.5" fill="#DB2777" /><rect x="38" y="1" width="11" height="30" rx="5.5" fill="#DB2777" />
    <rect x="18" y="5" width="5" height="21" rx="2.5" fill="#FBCFE8" /><rect x="41" y="5" width="5" height="21" rx="2.5" fill="#FBCFE8" />
    <circle cx="32" cy="40" r="21" fill="#EC4899" />
    <Face y={38} gap={9} mouth={false} />
    <ellipse cx="32" cy="46" rx="3" ry="2.2" fill={INK} />
    <path d="M30 49 v3 M34 49 v3" stroke={WHITE} strokeWidth={2.2} strokeLinecap="round" />
  </>,
  turtle: <>
    <path d="M32 8 L54 20 L54 44 L32 56 L10 44 L10 20 Z" fill="#0E7A6E" />
    <path d="M32 18 L44 25 L44 39 L32 46 L20 39 L20 25 Z" fill="#14B8A6" />
    <circle cx="32" cy="33" r="13" fill="#5EEAD4" />
    <Face y={31} gap={6} eye={3.4} mouthY={37} />
  </>,
  octopus: <>
    <path d="M10 34 Q10 6 32 6 Q54 6 54 34 L54 48 q-4 8 -7 0 q-4 8 -7.5 0 q-3.5 8 -7.5 0 q-3.5 8 -7.5 0 q-3 8 -7 0 q-3 8 -7.5 0 Z" fill="#B0179A" />
    <Face y={30} gap={10} mouthY={39} />
    <circle cx="16" cy="38" r="3" fill="#F9A8D4" opacity=".8" /><circle cx="48" cy="38" r="3" fill="#F9A8D4" opacity=".8" />
  </>,
  unicorn: <>
    <path d="M32 0 L37 18 L27 18 Z" fill="#C6EE3A" />
    <path d="M44 10 Q62 18 54 46 Q50 30 42 24 Z" fill="#2B4ADB" />
    <circle cx="32" cy="36" r="22" fill="#EDE9FE" />
    <path d="M14 22 L22 10 L24 24 Z" fill="#EDE9FE" />
    <Face y={34} gap={9} mouthY={43} />
    <circle cx="16" cy="42" r="3" fill="#F9A8D4" /><circle cx="48" cy="42" r="3" fill="#F9A8D4" />
  </>
};

const DEFAULT = <>
  <rect x="6" y="6" width="52" height="52" rx="18" fill="#2B4ADB" />
  <Face y={30} gap={10} mouthY={40} eye={4} />
</>;

/** A character by its stored avatar word. Sized by className (1em by default, so it follows the text size). */
export function Critter({ name, className, title }: { name: string | null | undefined; className?: string; title?: string }) {
  const art = (name && ART[name]) || DEFAULT;
  return (
    <svg viewBox="0 0 64 64" className={cn("inline-block h-[1em] w-[1em] shrink-0", className)} role={title ? "img" : undefined}
      aria-label={title} aria-hidden={title ? undefined : true}>{art}</svg>
  );
}
