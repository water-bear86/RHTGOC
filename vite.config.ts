import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  test: {
    // Stale worktrees under .claude-wt/ contain full copies of the suite.
    // Running them quadruples the local test count and the resulting
    // contention is what pushes timing-sensitive tests over their timeouts.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude-wt/**"],
  },
  build: {
    rollupOptions: {
      input: {
        game: `${root}index.html`,
        familyPhoto: `${root}family-photo.html`,
      },
      output: {
        manualChunks: {
          three: ["three"],
        },
      },
    },
  },
})
