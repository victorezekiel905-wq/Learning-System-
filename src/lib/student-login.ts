/**
 * School-made student logins (0970). A student without email signs in with a
 * username; behind it is an address on this domain that is never emailed.
 * Keep the domain fixed once students exist: their logins depend on it.
 */
export const STUDENT_LOGIN_DOMAIN = process.env.NEXT_PUBLIC_STUDENT_LOGIN_DOMAIN || "students.swiftcipher.invalid";

/** Guests' accounts made by the server (/api/live/guest), never emailed: guests.swiftcipher.invalid by default. */
export const GUEST_LOGIN_DOMAIN = `guests.${STUDENT_LOGIN_DOMAIN.replace(/^students\./, "")}`;

/** "Ada.Obi12" -> "ada.obi12@students.swiftcipher.invalid" */
export const loginEmail = (username: string) => `${username.trim().toLowerCase()}@${STUDENT_LOGIN_DOMAIN}`;

/** True for a username (no @), false for an email address. */
export const isUsername = (v: string) => !!v.trim() && !v.includes("@");
