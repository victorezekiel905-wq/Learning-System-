/** @type {import('next').NextConfig} */

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWs = supabase.replace(/^http/, "ws");
const dev = process.env.NODE_ENV !== "production";
const PYODIDE_CDN = "https://cdn.jsdelivr.net";

// §20 security headers. The app itself never evaluates strings as code:
// 'unsafe-eval' is only added in development (Next.js hot reload needs it).
// Student code runs in /sandbox/* workers, which get their own policy below.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  `connect-src 'self' ${supabase} ${supabaseWs}`,
  "frame-src 'self' https: blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join("; ");

// Student-code workers: may evaluate code, may load the pinned Pyodide build,
// may NOT reach the SwiftCipher API or Supabase (no session theft).
const sandboxCsp = [
  "default-src 'none'",
  `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' ${PYODIDE_CDN}`,
  `connect-src ${PYODIDE_CDN}`
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lets a production build/e2e run next to `npm run dev` without clobbering .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  env: {
    // Tags error reports with the deployed commit (Vercel sets VERCEL_GIT_COMMIT_SHA).
    NEXT_PUBLIC_RELEASE: process.env.NEXT_PUBLIC_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "local"
  },
  serverExternalPackages: ["pdf-parse", "mammoth"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }
        ]
      },
      {
        // Later rules override earlier ones for the same header key.
        source: "/sandbox/:path*",
        headers: [
          { key: "Content-Security-Policy", value: sandboxCsp },
          { key: "Cache-Control", value: "public, max-age=3600" }
        ]
      }
    ];
  }
};

export default nextConfig;
