import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
    include: ["services/**/*.test.ts", "infra/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
});
