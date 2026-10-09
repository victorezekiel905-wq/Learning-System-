/**
 * Shown inside the app's frame the moment a link is clicked, while the server
 * prepares the page, so a click always answers at once. Next also prefetches
 * this for links in view, which makes moving between pages feel instant.
 */
export default function Loading() {
  return (
    <div className="page" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mb-7 sm:mb-9" aria-hidden>
        <div className="h-8 w-56 animate-pulse rounded-lg bg-ink-100 sm:h-9" />
        <div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded bg-ink-100" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-ink-100/70" />)}
      </div>
      <div className="mt-6 h-64 animate-pulse rounded-2xl bg-ink-100/70" aria-hidden />
    </div>
  );
}
