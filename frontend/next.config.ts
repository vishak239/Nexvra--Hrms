import type { NextConfig } from "next";

// /api/* is proxied to Django by src/app/api/[...path]/route.ts (BACKEND_URL, default http://127.0.0.1:8000).
const nextConfig: NextConfig = {
  // Django URLs end with "/"; keep them intact when proxying.
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
