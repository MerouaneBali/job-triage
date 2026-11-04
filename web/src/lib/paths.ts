import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Monorepo root (parent of web/). */
export function getRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (
      existsSync(join(dir, "src", "db.mjs")) &&
      existsSync(join(dir, "data"))
    ) {
      return dir;
    }
    if (
      existsSync(join(dir, "web", "package.json")) &&
      existsSync(join(dir, "package.json"))
    ) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), "..");
}

export function dataPaths(root = getRepoRoot()) {
  return {
    root,
    dumps: join(root, "data", "dumps"),
    db: join(root, "data", "job-triage.sqlite"),
    envFile: join(root, ".env"),
  };
}
