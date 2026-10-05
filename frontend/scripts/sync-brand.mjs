// Copies the official brand assets from /brand (single source of truth) into public/brand,
// byte-for-byte. Never edit the copies; they are regenerated on every dev/build.
//
// The copies are committed too, because a frontend-only build (e.g. Railway with Root Directory
// "frontend") cannot see /brand. In that case the committed copies are used as they are.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "..", "brand");
const dest = join(root, "public", "brand");
const isAsset = (file) => /\.(svg|png)$/i.test(file);

if (existsSync(src)) {
  mkdirSync(dest, { recursive: true });
  for (const file of readdirSync(src)) {
    if (isAsset(file)) copyFileSync(join(src, file), join(dest, file));
  }
} else if (existsSync(dest) && readdirSync(dest).some(isAsset)) {
  console.log("sync-brand: /brand is not in this build context; using the committed public/brand copies.");
} else {
  throw new Error("sync-brand: no brand assets found (neither /brand nor public/brand).");
}
