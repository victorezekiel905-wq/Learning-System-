/** Lobby avatars: the stored word (database check ^[a-z]{2,16}$) and its name. Drawn by <Critter>. */
export const AVATARS: Record<string, string> = {
  fox: "Fox", owl: "Owl", panda: "Panda", tiger: "Tiger", frog: "Frog", koala: "Koala",
  penguin: "Penguin", lion: "Lion", rabbit: "Rabbit", turtle: "Turtle", octopus: "Octopus", unicorn: "Unicorn"
};

/** The avatar word if it is one of ours, else null (Critter then draws the default face). */
export function avatarFor(key: string | null | undefined): string | null {
  return key && AVATARS[key] ? key : null;
}
