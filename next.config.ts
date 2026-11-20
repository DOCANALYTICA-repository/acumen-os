import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // uploads are capped at 4 MB per file; Vercel rejects request bodies over ~4.5 MB
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
