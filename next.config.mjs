/** @type {import('next').NextConfig} */

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWs = supabase.replace(/^http/, "ws");

// §20 security headers. 'unsafe-eval' is required only by the in-browser code
// sandbox (student code runs in an opaque-origin iframe that inherits this CSP).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https:`,
  `media-src 'self' blob: https:`,
  `connect-src 'self' ${supabase} ${supabaseWs} https://cdn.jsdelivr.net`,
  "frame-src 'self' https: blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"]
  },
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
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }
        ]
      }
    ];
  }
};

export default nextConfig;
