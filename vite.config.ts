import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
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
