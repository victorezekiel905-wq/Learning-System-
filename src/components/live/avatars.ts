/** Lobby avatars: a word (stored) and what it looks like. Words match the database check ^[a-z]{2,16}$. */
export const AVATARS: Record<string, string> = {
  fox: "🦊", owl: "🦉", panda: "🐼", tiger: "🐯", frog: "🐸", koala: "🐨",
  penguin: "🐧", lion: "🦁", rabbit: "🐰", turtle: "🐢", octopus: "🐙", unicorn: "🦄"
};

export function avatarFor(key: string | null | undefined): string | null {
  return key && AVATARS[key] ? AVATARS[key] : null;
}
