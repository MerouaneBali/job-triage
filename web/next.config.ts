import type { NextConfig } from "next";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoEnv = resolve(__dirname, "../.env");
if (existsSync(repoEnv)) {
  loadDotenv({ path: repoEnv, quiet: true });
}

/** Mount under Tailscale Serve `/job-triage` (and direct :4173/job-triage). */
const basePath = process.env.NEXT_BASE_PATH ?? "/job-triage";

const nextConfig: NextConfig = {
  basePath,
  // Inlined for client fetch / EventSource / SW registration (Next does not
  // auto-prefix raw fetch("/api/...") calls).
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  serverExternalPackages: ["dotenv", "better-sqlite3"],
  // Phone / Tailscale / LAN hosts hitting `next dev` (HMR + /_next/*).
  // MagicDNS is multi-label (host.tailxxxx.ts.net) → need ** not *.
  allowedDevOrigins: [
    "**.ts.net",
    "*.ts.net",
    "127.0.0.1",
  ],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
