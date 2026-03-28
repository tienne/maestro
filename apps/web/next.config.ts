import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Static export for Tauri production builds
  // In dev mode, Tauri connects to the Next.js dev server via devUrl
  ...(isProd ? { output: "export" } : {}),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
