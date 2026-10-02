// Copies the official brand assets from /brand (single source of truth) into public/brand,
// byte-for-byte. Never edit the copies; they are regenerated on every dev/build.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "..", "brand");
const dest = join(root, "public", "brand");
mkdirSync(dest, { recursive: true });
for (const file of readdirSync(src)) {
  if (/\.(svg|png)$/i.test(file)) copyFileSync(join(src, file), join(dest, file));
}
