import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // matikan tombol indikator dev Next.js (logo "N" bulat di pojok layar)
  devIndicators: false,
};

export default nextConfig;
