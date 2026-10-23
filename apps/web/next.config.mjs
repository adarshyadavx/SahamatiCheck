/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@sahamati/ui", "@sahamati/i18n", "@sahamati/contracts"],
  poweredByHeader: false,
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
