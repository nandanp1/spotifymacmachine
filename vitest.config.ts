import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      "@main": fromRoot("./src/main"),
      "@preload": fromRoot("./src/preload"),
      "@renderer": fromRoot("./src/renderer"),
      "@shared": fromRoot("./src/shared"),
    },
  },
  test: {
    clearMocks: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    restoreMocks: true,
  },
});
