import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Keep file watching scoped to the backend project directory.
  turbopack: {
    root: backendRoot,
  },
};

export default nextConfig;
