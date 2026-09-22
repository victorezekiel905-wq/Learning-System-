/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" }
    ]
  },
  experimental: {
    serverActions: { bodySizeLimit: "4mb" }
  }
};
export default nextConfig;
