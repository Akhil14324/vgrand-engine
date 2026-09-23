import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship as TS source; Next transpiles them on demand.
  transpilePackages: ["@prompthub/types"],
  // Monorepo root — keeps output tracing inside the project even though an
  // unrelated package-lock.json exists higher up on this machine.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default nextConfig;
