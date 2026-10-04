import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Next.js compiles JSX itself (tsconfig "jsx": "preserve"); tests need the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // jsdom start-up is heavy; a few workers and a generous timeout keep runs stable on modest machines.
    maxWorkers: 4,
    testTimeout: 20_000,
  },
});
