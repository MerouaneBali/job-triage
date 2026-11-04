import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Monorepo root (parent of web/). */
export function getRepoRoot(): string {
  // Prefer walking up from cwd so next dev / next start both work.
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (
      existsSync(join(dir, "src", "stage3", "run.mjs")) &&
      existsSync(join(dir, "data"))
    ) {
      return dir;
    }
    if (existsSync(join(dir, "web", "package.json")) && existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: cwd is web/
  return resolve(process.cwd(), "..");
}

export function dataPaths(root = getRepoRoot()) {
  return {
    root,
    dumps: join(root, "data", "dumps"),
    stage1: join(root, "data", "stage1"),
    stage2: join(root, "data", "stage2"),
    stage3: join(root, "data", "stage3"),
    envFile: join(root, ".env"),
  };
}
