/** Postgres error codes raised by the SwiftCipher RPCs, mapped to HTTP. */
const STATUS_BY_CODE: Record<string, number> = {
  "42501": 403, // forbidden
  "28000": 401, // invalid device credentials
  P0002: 404, // not found
  "22023": 400, // invalid input
  "22P02": 400, // malformed uuid/json
  "23505": 409, // unique violation
  "23503": 409, // foreign key
  P0001: 409 // business rule
};

export type RpcError = { message: string; code?: string; details?: string; hint?: string };

export function statusForError(err: RpcError | null | undefined): number {
  if (!err) return 500;
  return STATUS_BY_CODE[err.code ?? ""] ?? 500;
}

/** Human message; hides raw SQL errors that were not written for users. */
export function messageForError(err: RpcError | null | undefined): string {
  if (!err) return "Something went wrong.";
  if (err.code && STATUS_BY_CODE[err.code]) {
    if (err.code === "23505") return "That already exists.";
    if (err.code === "22P02") return "Some of the data sent was malformed.";
    if (err.code === "42501" && /row-level security|permission denied/i.test(err.message)) {
      return "You don't have permission to do that.";
    }
    return err.message;
  }
  return "Something went wrong. Please try again.";
}
