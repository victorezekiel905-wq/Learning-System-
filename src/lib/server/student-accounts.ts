import { randomInt } from "node:crypto";

// Short, friendly words for starting passwords children can type (no look-alike letters).
const WORDS = [
  "mango", "river", "lion", "tiger", "orange", "pencil", "rocket", "garden", "planet", "sunny", "cloud", "eagle",
  "banana", "school", "music", "yellow", "purple", "silver", "forest", "ocean", "zebra", "camel", "honey", "candle",
  "maple", "pepper", "tomato", "rabbit", "falcon", "island", "bridge", "drum", "kettle", "lemon", "parrot", "violet"
];

/** e.g. "mango-river-47": easy to read from a card, long enough to be safe for a first sign-in. */
export function newPassword(): string {
  const w = () => WORDS[randomInt(WORDS.length)]!;
  return `${w()}-${w()}-${randomInt(10, 100)}`;
}

/** "Adaeze Okafor-Bello" -> "adaeze.okaforbello"; the caller adds digits to make it unique. */
export function usernameBase(fullName: string): string {
  const parts = fullName.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter(Boolean);
  const base = parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] ?? "";
  const cut = base.slice(0, 24).replace(/\.$/, "");
  return cut.length >= 3 ? cut : `student${cut}`;
}

/** A candidate username: the base plus two or three digits. */
export const usernameCandidate = (base: string) => `${base}${randomInt(10, 1000)}`;
