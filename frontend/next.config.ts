import type { NextConfig } from "next";

const apiOrigin = process.env.RIVENTA_API_ORIGIN?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async rewrites() {
    if (!apiOrigin) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("RIVENTA_API_ORIGIN must be configured for production.");
      }

      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/:path*`
      }
    ];
  }
};

export default nextConfig;
