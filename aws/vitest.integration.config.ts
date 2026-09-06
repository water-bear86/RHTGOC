import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ["integration/**/*.test.ts", "e2e/**/*.test.ts"],
  },
});
