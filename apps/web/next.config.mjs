/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@sahamati/ui", "@sahamati/i18n", "@sahamati/contracts"],
  poweredByHeader: false,
  // NEXT_PUBLIC_API_BASE=same-origin (or "/"): the browser calls the API on the website's own address and Next.js passes
  // /v1/* and /version on to the backend (API_BASE_INTERNAL). One address then serves everything, which
  // is what a phone on the same Wi-Fi (or the Android app) needs, and no CORS setup is required.
  async rewrites() {
    if (!["/", "same-origin"].includes(process.env.NEXT_PUBLIC_API_BASE ?? "")) return [];
    const api = (process.env.API_BASE_INTERNAL || "http://localhost:8000").replace(/\/+$/, "");
    return [
      { source: "/v1/:path*", destination: `${api}/v1/:path*` },
      { source: "/version", destination: `${api}/version` },
    ];
  },
  async headers() {
    return [
      {
        // Reports are unlisted: never index them.
        source: "/:locale/r/:id*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
