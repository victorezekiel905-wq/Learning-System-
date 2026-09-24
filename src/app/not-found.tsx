import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-lg place-items-center px-6 text-center">
      <div className="space-y-4">
        <p className="font-display text-5xl font-extrabold text-brand-600">404</p>
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="text-sm text-ink-600">The link may be old, or you may not have access to this page.</p>
        <Link href="/dashboard" className="btn btn-primary no-underline">Go to your dashboard</Link>
      </div>
    </main>
  );
}
