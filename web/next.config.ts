import type { NextConfig } from "next";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoEnv = resolve(__dirname, "../.env");
if (existsSync(repoEnv)) {
  loadDotenv({ path: repoEnv, quiet: true });
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["dotenv", "better-sqlite3"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
