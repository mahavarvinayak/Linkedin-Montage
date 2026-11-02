import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    // Server Actions are not used for mutations in this app; route handlers are.
  },
};

export default nextConfig;
