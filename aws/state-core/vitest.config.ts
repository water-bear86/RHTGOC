import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: ".vite",
  test: {
    include: ["test/**/*.test.ts"],
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 100,
        lines: 90,
      },
    },
  },
});
