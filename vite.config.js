import { defineConfig } from "vite";

// GitHub Pages serves this repo from https://cvree.github.io/PhlebLearn/ (a project
// page, not a user/org root page), so every built asset URL must be prefixed with
// /PhlebLearn/. This must be the config's default — `vite preview` serves the
// build output and needs the SAME base the build was made with (checking
// `command` here is unreliable: `vite preview` does not report `command:
// "build"`, so a `command === "build" ? ... : "/"` conditional silently breaks
// preview, serving everything at "/" while index.html references
// /PhlebLearn/... and 404s via an SPA-fallback 200 that *looks* like success).
// Local dev overrides back to "/" via an explicit --base flag in package.json's
// "dev" script instead, so this file only needs one unconditional value.
export default defineConfig({
  base: "/PhlebLearn/",
  build: {
    outDir: "dist",
    assetsDir: "assets/build",
    rollupOptions: {
      output: {
        // three.js is the overwhelming majority of bundle size and changes far
        // less often than our own code — its own chunk means browsers cache it
        // across app deploys instead of re-downloading it on every release.
        manualChunks: {
          three: ["three"],
        },
      },
    },
  },
});
