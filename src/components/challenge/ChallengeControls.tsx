"use client";
import { useState } from "react";

export default function ChallengeControls({ gameId, started }: { gameId: string; started: boolean }) {
  const [busy, setBusy] = useState(false);

  async function post(path: string, body?: unknown) {
    setBusy(true);
    try {
      await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      {!started && (
        <button className="btn btn-primary" disabled={busy} onClick={() => post(`/api/games/${gameId}/start`)}>
          Start game
        </button>
      )}
      {started && (
        <>
          <button className="btn btn-ghost" disabled={busy} onClick={() => post(`/api/games/${gameId}/question`, { idx: -1 })}>
            Finish questions
          </button>
        </>
      )}
      <button className="btn btn-danger" disabled={busy} onClick={() => post(`/api/games/${gameId}/end`)}>
        End game
      </button>
    </div>
  );
}
