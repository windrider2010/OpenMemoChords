import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vinext emits a minimal self-hosted runtime used by the production image.
  output: "standalone",
};

export default nextConfig;
