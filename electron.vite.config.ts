import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import {
  defineConfig,
  externalizeDepsPlugin,
  loadEnv,
} from "electron-vite";

const fromRoot = (...segments: string[]) => resolve(import.meta.dirname, ...segments);

export default defineConfig(({ mode }) => {
  const publicEnvironment = loadEnv(mode, import.meta.dirname, "VITE_");

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        "process.env.VITE_SPOTIFY_CLIENT_ID": JSON.stringify(
          publicEnvironment.VITE_SPOTIFY_CLIENT_ID ?? "",
        ),
        "process.env.VITE_SPOTIFY_REDIRECT_URI": JSON.stringify(
          publicEnvironment.VITE_SPOTIFY_REDIRECT_URI ||
            "http://127.0.0.1:43821/callback",
        ),
      },
      resolve: {
        alias: {
          "@main": fromRoot("src/main"),
          "@shared": fromRoot("src/shared"),
        },
      },
      build: {
        rollupOptions: {
          input: fromRoot("src/main/main.ts"),
          output: {
            entryFileNames: "main.js",
          },
        },
      },
    },
    preload: {
      resolve: {
        alias: {
          "@preload": fromRoot("src/preload"),
          "@shared": fromRoot("src/shared"),
        },
      },
      build: {
        // Sandboxed preloads can require Electron built-ins only. Bundle every
        // third-party validator into this single standalone CommonJS file.
        externalizeDeps: false,
        rollupOptions: {
          input: fromRoot("src/preload/preload.ts"),
          output: {
            entryFileNames: "preload.js",
            format: "cjs",
            inlineDynamicImports: true,
          },
        },
      },
    },
    renderer: {
      root: fromRoot("src/renderer"),
      publicDir: fromRoot("public"),
      plugins: [react()],
      resolve: {
        alias: {
          "@renderer": fromRoot("src/renderer"),
          "@shared": fromRoot("src/shared"),
        },
      },
      build: {
        rollupOptions: {
          input: fromRoot("src/renderer/index.html"),
        },
      },
    },
  };
});
