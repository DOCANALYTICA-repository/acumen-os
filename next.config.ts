import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // submissions allow files up to the per-round limit (default 25 MB)
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default nextConfig;
