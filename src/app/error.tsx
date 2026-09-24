"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui";
import { reportError } from "@/lib/report-error";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError(error, error.digest ? `page digest=${error.digest}` : "page"); }, [error]);
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-lg place-items-center px-6 text-center">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-sm text-ink-600">The problem has been reported automatically. Try again, or go back to your dashboard.</p>
        {error.digest && <p className="font-mono text-xs text-ink-500">Reference: {error.digest}</p>}
        <div className="flex justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Link href="/dashboard" className="btn btn-secondary no-underline">Dashboard</Link>
        </div>
      </div>
    </main>
  );
}
